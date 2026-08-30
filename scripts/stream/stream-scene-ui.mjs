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
import {
  zustandAusCache, schalteKarte, warmeZustaende,
  ordnerVorschau, ordnerZusagen, ordnerLoesen, szenenImOrdner,
} from "./stream-offline.mjs"

const KLASSE = "beneos-offline-held"

const mb = n => Math.round((Number(n) || 0) / 1048576)
/** Ueber einem Gigabyte wird in GB gerundet: "1843 MB" liest niemand als Menge. */
const menge = n => {
  const m = mb(n)
  return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${m} MB`
}

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

/**
 * Wie `localize`, nur mit Werten, und mit einem Ersatztext, der dieselben
 * Platzhalter kennt.
 *
 * Foundrys `format` gibt bei einem unbekannten Schluessel den Schluessel
 * zurueck, nicht den Ersatztext. Ein Modul, dessen Sprachdatei einen Eintrag
 * noch nicht traegt, zeigte dem Kunden dann `BENEOS.Stream.Offline.FolderIntro`
 * statt eines Satzes. Deshalb wird der Ersatztext hier selbst gefuellt, mit
 * derselben geschweiften Schreibweise, die Foundry benutzt.
 */
function formatiere(key, werte, fallback) {
  try {
    const t = game.i18n.format(key, werte)
    if (t && t !== key) return t
  } catch (_) { /* faellt durch */ }
  return String(fallback).replace(/\{(\w+)\}/g, (_, n) => String(werte?.[n] ?? ""))
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
    /* Der Eintrag, der nicht mehr ins Kontingent passt: sichtbar, aber
       erkennbar nicht zum Klicken. Der Klick fuehrt trotzdem irgendwohin,
       naemlich zu einer Erklaerung mit Zahlen. */
    #context-menu li.beneos-offline-voll,
    .beneos-offline-voll {
      color: #c9503f;
      opacity: 0.75;
    }
    #context-menu li.beneos-offline-voll i { color: #c9503f; }

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

    /* Die Vorschau vor dem Ordnergriff. Bewusst schmucklos: sie hat genau eine
       Aufgabe, naemlich eine Zahl zu zeigen, bevor Gigabyte fliessen. */
    .beneos-offline-vorschau .bo-liste {
      list-style: none; margin: 6px 0; padding: 0;
      max-height: 220px; overflow-y: auto;
      border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 3px;
    }
    .beneos-offline-vorschau .bo-liste li {
      display: flex; justify-content: space-between; gap: 12px;
      padding: 3px 8px; font-size: 0.92em;
    }
    .beneos-offline-vorschau .bo-liste li:nth-child(even) {
      background: rgba(128, 128, 128, 0.08);
    }
    /* Ziffern in einer Spalte muessen untereinander stehen, sonst laesst sich
       die Liste nicht ueberfliegen. */
    .beneos-offline-vorschau .bo-menge {
      font-variant-numeric: tabular-nums; opacity: 0.75; white-space: nowrap;
    }
    .beneos-offline-vorschau .bo-summe {
      display: flex; align-items: baseline; gap: 8px; margin: 8px 0 4px;
    }
    .beneos-offline-vorschau .bo-summe strong { font-size: 1.15em; }
    .beneos-offline-vorschau .bo-summe span { opacity: 0.75; font-size: 0.92em; }
    .beneos-offline-vorschau .bo-hinweis { margin: 2px 0; font-size: 0.88em; opacity: 0.75; }
    .beneos-offline-vorschau .bo-warnung {
      margin: 6px 0 0; padding: 5px 8px; font-size: 0.9em;
      color: #c9503f; border-left: 2px solid #c9503f;
      background: rgba(201, 80, 63, 0.08);
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

    // Der Streifen sagt DASS etwas offline liegt, der Tooltip sagt WAS und wie
    // viel. Ohne ihn muss der Spielleiter das Vorratsfenster oeffnen, um zu
    // erfahren, ob die gruene Markierung an dieser Zeile seine 400 MB oder
    // seine 40 kostet.
    //
    // Gesetzt wird `data-tooltip` an derselben Stelle wie die Klasse, weil
    // Foundry die Liste bei jeder Dokumentaenderung vollstaendig neu zeichnet
    // und beides sonst gemeinsam verschwaende.
    if (z?.zugesagt && z.karte) {
      li.dataset.tooltip = formatiere("BENEOS.Stream.Offline.SceneTooltip",
        { name: z.karte.name, size: menge(z.karte.bytes) },
        "Available offline: {name} ({size})")
    } else if (li.dataset?.tooltip?.startsWith?.("Available offline")
            || li.dataset?.beneosOfflineTip === "1") {
      // Nur den eigenen Tooltip zurueckziehen. Ein fremder, den Foundry oder
      // ein anderes Modul gesetzt hat, bleibt stehen.
      delete li.dataset.tooltip
    }
    if (z?.zugesagt && z.karte) li.dataset.beneosOfflineTip = "1"
    else delete li.dataset.beneosOfflineTip
  }
}

/**
 * Der Ordner, mit Vorschau vor dem Zugriff.
 *
 * DIE VORSCHAU IST DIE BEDINGUNG, NICHT DIE HOEFLICHKEIT.
 *
 * Ein Release wiegt zwischen 0,4 und 2,0 GB, das Kontingent beginnt bei drei.
 * Ein Fehlgriff raeumt damit das halbe Kontingent aus, und zurueckzunehmen
 * kostet zwar nichts, aber der zweite Griff kostet dieselben Bytes noch
 * einmal. Deshalb steht vor dem Holen, was es kostet und was danach frei ist.
 *
 * Passt es nicht, wird nicht abgebrochen, sondern die Zahl gezeigt und der
 * Knopf gesperrt: der Spielleiter soll sehen, ob eine einzige Freigabe genuegt
 * oder ob er umplanen muss.
 */
async function ordnerDialog(folder) {
  const v = await ordnerVorschau(folder)
  if (!v.karten.length) {
    ui.notifications?.info(localize("BENEOS.Stream.Offline.FolderEmpty",
      "No streamed Beneos maps in this folder."))
    return
  }

  const zeilen = v.karten.filter(k => !k.zugesagt)
    .sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
    .map(k => `<li><span>${foundry.utils.escapeHTML?.(k.name) ?? k.name}</span>`
            + `<span class="bo-menge">${menge(k.bytes)}</span></li>`).join("")

  const hinweise = []
  if (v.schonDa > 0) {
    hinweise.push(formatiere("BENEOS.Stream.Offline.FolderAlready", { n: v.schonDa },
      "{n} of them are already offline and cost nothing more."))
  }
  if (v.ohneKarte > 0) {
    // Szenen ohne bekannte Karte sind der Normalfall bei allem, was nicht von
    // Beneos kommt. Sie zu verschweigen liesse den Spielleiter raten, warum
    // die Zahl nicht zu seinem Ordner passt.
    hinweise.push(formatiere("BENEOS.Stream.Offline.FolderSkipped", { n: v.ohneKarte },
      "{n} scenes are not streamed Beneos maps and stay untouched."))
  }

  const inhalt = `
    <div class="beneos-offline-vorschau">
      <p>${formatiere("BENEOS.Stream.Offline.FolderIntro", { n: v.offen },
        "{n} maps will be fetched for offline use.")}</p>
      <ul class="bo-liste">${zeilen}</ul>
      <p class="bo-summe">
        <strong>${menge(v.bytes)}</strong>
        <span>${formatiere("BENEOS.Stream.Offline.FolderFree", { free: menge(v.frei) }, "of {free} free")}</span>
      </p>
      ${hinweise.map(h => `<p class="bo-hinweis">${h}</p>`).join("")}
      ${v.passt ? "" : `<p class="bo-warnung">${localize("BENEOS.Stream.Offline.FolderTooBig",
        "This does not fit your offline quota. Remove other maps first.")}</p>`}
    </div>`

  const bestaetigt = await Dialog.confirm({
    title: localize("BENEOS.Stream.Offline.FolderTitle", "Keep this folder offline?"),
    content: inhalt,
    yes: () => true, no: () => false, defaultYes: false,
  })
  if (!bestaetigt) return
  if (!v.passt) return   // Der Knopf laesst sich klicken, die Grenze bleibt.

  let zaehler = 0
  const bericht = await ordnerZusagen(folder, {
    onProgress: ({ index, gesamt, name }) => {
      // Eine Meldung je Karte waere bei dreissig Karten eine Lawine. Nur jede
      // fuenfte, und die erste immer, damit der Spielleiter sieht, dass etwas
      // laeuft.
      if (index === 0 || ++zaehler % 5 === 0) {
        ui.notifications?.info(formatiere("BENEOS.Stream.Offline.FolderProgress",
          { i: index + 1, n: gesamt, name },
          "Fetching {i} of {n}: {name}"))
      }
    },
  })

  if (bericht.abbruch) {
    ui.notifications?.warn(formatiere("BENEOS.Stream.Offline.FolderPartial",
      { name: bericht.abbruch.name, n: bericht.geholt, g: bericht.gesamt, size: menge(bericht.bytes) },
      "Stopped at '{name}'. {n} of {g} maps are offline ({size})."))
    return
  }
  ui.notifications?.info(formatiere("BENEOS.Stream.Offline.FolderDone",
    { n: bericht.geholt, size: menge(bericht.bytes) },
    "{n} maps are available offline ({size})."))
}

/** Alles unter einem Ordner wieder freigeben, nach Rueckfrage. */
async function ordnerFreigeben(folder) {
  const v = await ordnerVorschau(folder)
  const dran = v.karten.filter(k => k.zugesagt)
  if (!dran.length) return

  const bytes = dran.reduce((s, k) => s + (Number(k.bytes) || 0), 0)
  const bestaetigt = await Dialog.confirm({
    title: localize("BENEOS.Stream.Offline.ReleaseFolderTitle", "Remove offline data?"),
    content: `<p>${formatiere("BENEOS.Stream.Offline.ReleaseFolderBody",
      { n: dran.length, size: menge(bytes) },
      "{n} maps ({size}) will be removed from this browser. They keep streaming as before.")}</p>`,
    yes: () => true, no: () => false, defaultYes: false,
  })
  if (!bestaetigt) return

  const b = await ordnerLoesen(folder)
  ui.notifications?.info(formatiere("BENEOS.Stream.Offline.ReleaseFolderDone", { n: b.geloest },
    "{n} maps were removed and stream again."))
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

    const halten = eintrag("BENEOS.Stream.Offline.Keep", "Keep offline",
      "fa-regular fa-hard-drive", false)
    // "Stream again" beschrieb die Folge, nicht die Handlung, und liess offen,
    // ob dabei etwas verschwindet. "Remove Offline Data" sagt, was passiert:
    // die Dateien gehen weg, die Karte laeuft danach wieder ueber die Leitung.
    // Betreiberentscheidung vom 30.08.2026.
    const loesen = eintrag("BENEOS.Stream.Offline.Release", "Remove Offline Data",
      "fa-regular fa-trash-can", true)

    // Passt die Karte nicht mehr ins Kontingent, erscheint derselbe Eintrag
    // rot und untaetig, statt zu fehlen. Ein fehlender Eintrag sieht aus wie
    // ein Defekt; ein roter erklaert sich. Dasselbe Muster benutzt das Modul
    // schon fuer die Static-Umschaltung ohne Standbild.
    const grundBedingung = halten.condition
    halten.condition = li => grundBedingung(li) && zustandVon(li)?.passt !== false
    const zuGross = {
      name: localize("BENEOS.Stream.Offline.Keep", "Keep offline"),
      label: localize("BENEOS.Stream.Offline.Keep", "Keep offline"),
      icon: `<i class="fa-regular fa-hard-drive"></i>`,
      classes: "beneos-offline-voll",
      condition: li => grundBedingung(li) && zustandVon(li)?.passt === false,
      callback: li => {
        const z = zustandVon(li)
        const mb = n => Math.round((n || 0) / 1048576)
        ui.notifications?.warn(game.i18n.format("BENEOS.Stream.Offline.QuotaExceeded",
          { name: z?.karte?.name || "", needs: mb(z?.karte?.bytes), free: mb(z?.frei) })
          || `This map needs ${mb(z?.karte?.bytes)} MB, but only ${mb(z?.frei)} MB of your offline `
           + `quota is free. Release another map first.`)
      },
    }

    options.push(halten, zuGross, loesen)
    return options
  })

  // Der Ordner. Zwei Eintraege, wie bei der Szene, nur fuer alles darunter.
  //
  // `getFolderContextOptions` ist ein GEMEINSAMER Hook aller Verzeichnisse:
  // er feuert auch fuer Akteure, Gegenstaende und Journale. Die Bedingung
  // prueft deshalb den Dokumenttyp des Ordners, nicht nur, ob Streaming laeuft.
  Hooks.on("getFolderContextOptions", (app, options) => {
    if (!game.user?.isGM) return options

    const ordnerVon = li => {
      const el = (li instanceof HTMLElement) ? li : li?.[0]
      const id = el?.dataset?.folderId || el?.closest?.("[data-folder-id]")?.dataset?.folderId
      const f = id ? game.folders?.get(id) : null
      return (f?.type === "Scene") ? f : null
    }

    // Der Ordner traegt seinen Zustand nicht selbst; er ergibt sich aus den
    // Szenen darunter. Die stehen im vorgewaermten Zustand, also laesst sich
    // das synchron beantworten, wie die `condition` es verlangt.
    const zaehlung = folder => {
      let bekannt = 0, zugesagt = 0
      for (const s of szenenImOrdner(folder)) {
        const z = zustandAusCache(String(s.id))
        if (!z?.bekannt) continue
        bekannt++
        if (z.zugesagt) zugesagt++
      }
      return { bekannt, zugesagt }
    }

    options.push({
      name:  localize("BENEOS.Stream.Offline.KeepFolder", "Keep all offline"),
      label: localize("BENEOS.Stream.Offline.KeepFolder", "Keep all offline"),
      icon:  `<i class="fa-regular fa-hard-drive"></i>`,
      condition: li => {
        if (!streamEnabled()) return false
        const f = ordnerVon(li); if (!f) return false
        const z = zaehlung(f)
        return z.bekannt > 0 && z.zugesagt < z.bekannt
      },
      callback: li => { const f = ordnerVon(li); if (f) ordnerDialog(f) },
    })

    options.push({
      name:  localize("BENEOS.Stream.Offline.ReleaseFolder", "Remove Offline Data"),
      label: localize("BENEOS.Stream.Offline.ReleaseFolder", "Remove Offline Data"),
      icon:  `<i class="fa-regular fa-trash-can"></i>`,
      condition: li => {
        if (!streamEnabled()) return false
        const f = ordnerVon(li); if (!f) return false
        return zaehlung(f).zugesagt > 0
      },
      callback: li => { const f = ordnerVon(li); if (f) ordnerFreigeben(f) },
    })

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
