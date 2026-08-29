/**
 * Settings for the streaming beta.
 *
 * All world-scoped, all hidden from the settings sheet, all GM-only, following
 * the pattern of `beneos-cloud-base-url` in beneos_utility.js. Hidden because a
 * beta switch has no business in a customer's options list, and world-scoped
 * because the addresses live in that world's documents.
 *
 * The main switch defaults to OFF. With it off, every code path in scripts/stream
 * returns immediately and the module behaves exactly as it does on main.
 */

export const MODULE_ID = "beneos-module"

export const SETTING = {
  mode: "beneos-stream-mode",
  key: "beneos-stream-key",
  base: "beneos-stream-base",
  localCache: "beneos-stream-local-cache",
  acknowledged: "beneos-stream-backup-acknowledged",
  pinStills: "beneos-stream-pin-stills",
  installMode: "beneos-stream-install-mode",
  budgetImage: "beneos-stream-budget-image",
  budgetVideo: "beneos-stream-budget-video",
  budgetAudio: "beneos-stream-budget-audio",
  budgetDraw: "beneos-stream-budget-draw",
  maxConcurrent: "beneos-stream-max-concurrent",
  // Das Verzeichnis der offline zugesagten Karten, und der Zeitpunkt der
  // letzten gueltigen Berechtigung. Siehe stream-offline.mjs.
  offlineHeld: "beneos-stream-offline-held",
  offlineSeen: "beneos-stream-offline-last-seen",
}

const DEFAULT_BASE = "https://gate.beneos.stream"

/** What an installation does with the files the manifest lists. */
export const INSTALL_MODE = { stream: "stream", download: "download" }

// Seconds, not milliseconds: these are numbers an operator reads and changes at
// a table, and a value in milliseconds invites a factor-of-a-thousand mistake.
const DEFAULT_BUDGET = { image: 30, video: 120, audio: 60, draw: 45 }

// Foundry never sets one, so every asset of a scene starts at once. On a wide
// line that is right; on a narrow one it makes each single file slower and
// bursts the budget on a line that would have sufficed.
const DEFAULT_MAX_CONCURRENT = 6

const VIDEO_EXT = /\.(webm|mp4|ogv|m4v)(\?|$)/i
const AUDIO_EXT = /\.(ogg|mp3|wav|flac|opus|m4a)(\?|$)/i

export function registerStreamSettings() {
  const world = { scope: "world", config: false, restricted: true }

  game.settings.register(MODULE_ID, SETTING.mode, {
    name: "Beneos Stream mode",
    hint: "Beta. Installs scenes without their heavy media and fetches it at play time.",
    ...world, type: Boolean, default: false,
  })

  game.settings.register(MODULE_ID, SETTING.key, {
    name: "Beneos Stream key",
    hint: "The beta key handed out by Beneos. Without it nothing is delivered.",
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

  // Existing worlds are allowed in the beta, so the first activation has to be
  // deliberate. This remembers that it was.
  game.settings.register(MODULE_ID, SETTING.acknowledged, {
    name: "Backup acknowledged",
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

  // Off is the pure form: nothing but the documents lands on the customer's
  // disk. On installs the pictures a scene needs in order to draw at all, which
  // the manifest marks per file with `pin`. Off first, on purpose: the pure
  // form gets measured before any compromise is made, and the switch exists so
  // that comparing the two costs a reload rather than a re-publish.
  game.settings.register(MODULE_ID, SETTING.pinStills, {
    name: "Install the pictures a scene needs to draw",
    hint: "Off streams everything. On keeps still images and scene backgrounds local.",
    ...world, type: Boolean, default: false,
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

/** Is the beta switched on AND usable? A mode without a key delivers nothing. */
export function streamEnabled() {
  return Boolean(read(SETTING.mode, false)) && Boolean(read(SETTING.key, ""))
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

export function streamBase() {
  return String(read(SETTING.base, DEFAULT_BASE) || DEFAULT_BASE).replace(/\/+$/, "")
}

/* ------------------------------------------------- den Schluessel besorgen */

/**
 * Die Kennung dieser Welt: SHA-256 ueber `game.world.id`, 64 Zeichen Hex.
 *
 * Bewusst dieselbe Bildung wie in der Telemetrie (`beneos_analytics.js`), aber
 * hier noch einmal in vier Zeilen statt ueber deren Klasse. Grund: die
 * Telemetrie schaltet sich ab, sobald das Streaming laeuft
 * (`beneos_analytics.js:111`). Wer sich auf sie stuetzte, haette eine
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
 * Holt den Streaming-Schluessel dieser Welt bei der Cloud und legt ihn ab.
 *
 * ER WIRD NIE UEBERSCHRIEBEN
 *
 * Steht schon einer da, wird er als `vorhanden` mitgeschickt und behalten. Der
 * Schluessel steckt im Pfad jeder gestreamten Adresse und damit in jedem
 * Szenendokument auf der Platte; ein neuer machte jede installierte Szene
 * unsichtbar. Das Mitschicken dient nur dazu, dass die Cloud den bis dahin
 * handgetippten Schluessel in ihre Verwaltung uebernehmen kann.
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

  const basis = (globalThis.BeneosUtility?.cloudBase?.() || "https://beneos.cloud").replace(/\/+$/, "")
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

    if (daten.stream_key !== vorhanden) {
      // Nur schreiben, wenn sich wirklich etwas aendert. Eine Einstellung zu
      // setzen ist in Foundry ein Weltschreibvorgang und wird an alle Spieler
      // verteilt; das bei jedem Weltstart zu tun waere Laerm ohne Anlass.
      await game.settings.set(MODULE_ID, SETTING.key, String(daten.stream_key))
      console.log(`Beneos Stream | Schluessel ${vorhanden ? "ersetzt" : "erhalten"}, Spiegel: ${daten.spiegel || "ueber den Takt"}`)
    }
    if (daten.base) {
      const sauber = String(daten.base).replace(/\/+$/, "")
      if (sauber && sauber !== streamBase()) await game.settings.set(MODULE_ID, SETTING.base, sauber)
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

export function pinStillsEnabled() {
  return Boolean(read(SETTING.pinStills, false))
}

/** `stream` or `download`. Anything unreadable counts as `stream`. */
export function installMode() {
  const value = String(read(SETTING.installMode, INSTALL_MODE.stream) || "").trim()
  return value === INSTALL_MODE.download ? INSTALL_MODE.download : INSTALL_MODE.stream
}

export function downloadMode() {
  return installMode() === INSTALL_MODE.download
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
  return seconds(SETTING.budgetImage, DEFAULT_BUDGET.image) * 1000
}

/** How long a whole scene may take to draw before the watchdog steps in. */
export function drawBudget() {
  return seconds(SETTING.budgetDraw, DEFAULT_BUDGET.draw) * 1000
}

export function maxConcurrent() {
  return seconds(SETTING.maxConcurrent, DEFAULT_MAX_CONCURRENT)
}

/** The address of one asset of one release variant. */
export function assetUrl(release, variant, path) {
  const clean = String(path).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")
  return `${streamBase()}/a/${encodeURIComponent(streamKey())}/${encodeURIComponent(release)}/${encodeURIComponent(variant)}/${clean}`
}
