/**
 * transfer-drossel.mjs
 *
 * Wie der native Installer auf HTTP 429 reagiert, und welche Dateien ein
 * spaeterer Lauf nachholen muss. Ohne Foundry-Globals, damit es ohne Foundry
 * pruefbar ist (transfer-drossel.test.mjs).
 *
 * TICK-17 (2026-11): ein Kunde verlor 2 von 254 Dateien. Der Installer gab bei
 * 429 nach zwei kurzen Pausen (0,5 s und 1,5 s) auf, sechs Bahnen fragten
 * dabei unabhaengig weiter, und der Reparaturdurchgang wiederholte dasselbe.
 * Auf The Forge holte danach kein Lauf die Luecke nach, weil dort der
 * HEAD-Durchgang fehlt und nur die Fehlschlaege des LAUFENDEN Laufs als
 * Kandidaten galten. Darum gibt es zwei Teile:
 *
 *   Drossel   429 heisst "zu viel": alle Bahnen pausieren gemeinsam, die Zahl
 *             der Bahnen halbiert sich und waechst danach langsam wieder.
 *   Luecken   was am Laufende fehlt, steht im Install-Vermerk und ist im
 *             naechsten Lauf Reparaturkandidat, auch auf The Forge.
 */

/** Hoechste einzelne Wartezeit, auch wenn Retry-After mehr verlangt. */
export const RATE_WAIT_MAX_MS = 60000
/** Wartezeiten ohne Retry-After. Der Browser sieht den Header nur, wenn der
 *  Server ihn in Access-Control-Expose-Headers freigibt; das Tor
 *  pack.beneos.stream tut das bisher nicht, also ist dies der Normalfall. */
export const RATE_BACKOFF_MS = Object.freeze([5000, 15000, 30000])
/** Versuche je Datei, die mit 429 enden duerfen. Eigenes Budget, damit eine
 *  Drossel keinen der Versuche fuer Netz- und Serverfehler verbraucht. */
export const RATE_MAX_ATTEMPTS = 4
/** Gesamte Pausenzeit je Installation. Danach verhaelt sich 429 wie vorher:
 *  ein dauerhaft drosselnder Server haelt die Installation nicht endlos fest,
 *  die Datei landet im Bericht und im Vermerk. */
export const RATE_TOTAL_MAX_MS = 600000
/** Erfolge in Folge ohne 429, nach denen eine Bahn dazukommt. */
export const ERHOLUNG_NACH = 8

/**
 * Retry-After in Millisekunden: Sekunden ("30") oder HTTP-Datum.
 * @returns {number|null} null, wenn der Wert fehlt oder nicht lesbar ist
 */
export function retryAfterMs(header, jetzt = Date.now()) {
  if (header === null || header === undefined) return null
  const s = String(header).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s) * 1000
  if (/^[+-]?\d/.test(s)) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? Math.max(0, t - jetzt) : null
}

/** Wartezeit vor dem `versuch`-ten Neuversuch (1-basiert) nach einer 429. */
export function wartezeit429(versuch, retryAfter = null) {
  const basis = (typeof retryAfter === "number" && Number.isFinite(retryAfter))
    ? retryAfter
    : RATE_BACKOFF_MS[Math.min(Math.max(1, versuch), RATE_BACKOFF_MS.length) - 1]
  return Math.min(RATE_WAIT_MAX_MS, Math.max(0, basis))
}

/** Monotone Uhr: eine zurueckgestellte Systemuhr verlaengert keine Pause. */
const monoton = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now())

/**
 * Bahnen und gemeinsame Pause eines Installationslaufs.
 *
 * `decke` ist die Obergrenze, die nur sinkt (die Duenn-Leitungs-Drossel setzt
 * sie auf 2), `lanes` die aktuelle Zahl darunter. `lanes` begrenzt zweierlei:
 * wie viele Bahnen `runPool` startet, und ueber `erwerbe`/`gib` wie viele
 * Abrufe gleichzeitig laufen. Das zweite ist noetig, weil eine Bahn mitten in
 * ihrer Datei neu versucht: ohne die Grenze fragten nach einer Pause alle
 * sechs angefangenen Dateien im selben Augenblick wieder.
 * Single-threaded JS: die Zaehler brauchen keine Sperre.
 */
export class Bahnsteuerung {
  constructor({ decke = 6, jetzt = monoton, schlafe = (ms) => new Promise(r => setTimeout(r, ms)), gesamtMaxMs = RATE_TOTAL_MAX_MS } = {}) {
    this.decke = Math.max(1, decke)
    this.lanes = this.decke
    this.pauseBis = 0
    this.gewartetMs = 0
    this.erfolgeInFolge = 0
    this.laufend = 0
    this._wartende = []
    this._jetzt = jetzt
    this._schlafe = schlafe
    this._gesamtMaxMs = gesamtMaxMs
  }

  /** Die Obergrenze senken (nie heben). */
  setzeDecke(n) {
    this.decke = Math.max(1, Math.min(this.decke, n))
    this.lanes = Math.min(this.lanes, this.decke)
  }

  /** Einen Abruf beginnen: wartet die Pause ab und bis ein Platz unter `lanes` frei ist. */
  async erwerbe() {
    for (;;) {
      await this.warte()
      if (this.laufend < this.lanes) { this.laufend += 1; return }
      await new Promise(r => this._wartende.push(r))
    }
  }

  /** Einen Abruf beenden, gleich ob gelungen oder nicht. */
  gib() {
    this.laufend = Math.max(0, this.laufend - 1)
    this._wecke()
  }

  _wecke() {
    const w = this._wartende
    this._wartende = []
    for (const r of w) r()
  }

  /**
   * Eine Bahn hat 429 bekommen. Verlaengert die gemeinsame Pause auf `ms` ab
   * jetzt. Halbiert werden die Bahnen einmal je Drossel-EREIGNIS: kommen sechs
   * 429 in dieselbe Pause, halbiert nur die erste, sonst fielen sechs
   * gleichzeitige Antworten von 6 direkt auf 1. Gezaehlt wird nur die
   * Verlaengerung der Pause, damit sie nicht sechsmal verbucht wird.
   * @returns {number|null} die Wartezeit, oder null, wenn das Gesamtbudget aufgebraucht ist
   */
  bei429(ms) {
    this.erfolgeInFolge = 0
    if (!this.pausiert()) this.lanes = Math.max(1, Math.floor(this.lanes / 2))
    const rest = this._gesamtMaxMs - this.gewartetMs
    if (rest <= 0) return null
    const w = Math.min(Math.max(0, ms), rest)
    const jetzt = this._jetzt()
    const bis = jetzt + w
    if (bis > this.pauseBis) {
      this.gewartetMs += bis - Math.max(this.pauseBis, jetzt)
      this.pauseBis = bis
    }
    return w
  }

  /** Eine Uebertragung ist gelungen. */
  beiErfolg() {
    this.erfolgeInFolge += 1
    if (this.erfolgeInFolge >= ERHOLUNG_NACH && this.lanes < this.decke) {
      this.lanes += 1
      this.erfolgeInFolge = 0
      this._wecke()
    }
  }

  restPauseMs() { return Math.max(0, this.pauseBis - this._jetzt()) }
  pausiert() { return this.restPauseMs() > 0 }

  /** Wartet, bis die gemeinsame Pause vorbei ist (sofort, wenn keine laeuft). */
  async warte() {
    for (let rest = this.restPauseMs(); rest > 0; rest = this.restPauseMs()) await this._schlafe(rest)
  }
}

/**
 * Was nach der `rate`-ten 429 einer Datei geschieht (1-basiert):
 *   { aktion: "warten", ms }   gemeinsame Pause angesetzt, danach neu versuchen
 *   { aktion: "aufgeben" }     Budget der Datei erschoepft, Fehler wie vorher melden
 *   { aktion: "wie-5xx" }      Gesamtbudget des Laufs erschoepft, kurzer Backoff wie bei
 *                              jedem anderen Serverfehler
 * Der Installer ruft genau diese Funktion, damit der Test die Entscheidung
 * prueft und nicht eine Abschrift davon.
 */
export function entscheide429(drossel, rate, retryAfter = null) {
  if (rate >= RATE_MAX_ATTEMPTS) return { aktion: "aufgeben" }
  const ms = drossel.bei429(wartezeit429(rate, retryAfter))
  return ms === null ? { aktion: "wie-5xx" } : { aktion: "warten", ms }
}

/**
 * `worker(item, index)` ueber `items`, hoechstens `concurrency` gleichzeitig.
 *
 * Mit `budget` ({ lanes }) passt sich die Zahl der Bahnen an: eine Bahn zieht
 * sich zwischen zwei Items zurueck, wenn es zu viele sind, und es startet eine
 * neue, wenn `budget.lanes` wieder steigt und noch Arbeit uebrig ist. Laufende
 * Uebertragungen werden nie abgebrochen. Loest erst auf, wenn ALLE Bahnen
 * fertig sind, auch die nachtraeglich gestarteten. Ein Worker darf nicht
 * werfen (Fehler je Item behandelt er selbst).
 */
export async function runPool(items, concurrency, worker, budget = null) {
  const n = items.length
  if (n === 0) return
  let next = 0
  let active = 0
  const bahnen = []
  const grenze = () => Math.max(1, Math.min(concurrency, budget ? budget.lanes : concurrency))
  const starte = () => {
    while (active < grenze() && next < n) {
      active += 1
      bahnen.push(bahn())
    }
  }
  const bahn = async () => {
    try {
      for (let i = next++; i < n; i = next++) {
        await worker(items[i], i)
        if (budget && active > grenze()) return
        starte()
      }
    } finally {
      active -= 1
    }
  }
  starte()
  for (let k = 0; k < bahnen.length; k++) await bahnen[k]
}

/**
 * Luecken fuer den Install-Vermerk. Vereinigt wie die sceneIds des Vermerks:
 * die vorigen bleiben, ausser dieser Lauf hat das Ziel uebertragen oder als
 * vorhanden geprueft, und die eigenen Fehlschlaege kommen dazu. Ein gescopter
 * Lauf fuer Szene 7 loescht damit nicht die Luecken von Szene 3.
 *
 * `toolarge` bleibt drin: der Bericht raet dem Kunden, die Grenze seines
 * Proxys zu heben und Retry zu klicken, also muss der naechste Lauf es
 * versuchen.
 *
 * @param {string[]|undefined} vorher   missingTargets des vorigen Vermerks
 * @param {Set<string>} erledigt        in diesem Lauf uebertragen oder geprueft
 * @param {string[]} fehlgeschlagen     Ziele aus assetFailures am Laufende
 * @param {Set<string>|null} releaseZiele  alle Ziele des Release, nur bei einem
 *                                      ungescopten Lauf; null laesst vorige Luecken stehen
 * @returns {string[]} sortiert, ohne Doppel
 *
 * `vorher` ist der Vermerk im Augenblick des Schreibens (recordInstall), nicht
 * der vom Laufbeginn.
 */
export function naechsteLuecken(vorher, erledigt, fehlgeschlagen, releaseZiele = null) {
  // Kennt der Lauf das GANZE Release (nicht gescopt), fallen Luecken weg, die
  // es dort nicht mehr gibt. Sonst wuechse der Vermerk mit jeder Fassung.
  const imRelease = (t) => !releaseZiele || releaseZiele.has(t)
  const s = new Set(Array.isArray(vorher) ? vorher.map(String).filter(t => t && imRelease(t)) : [])
  for (const t of erledigt || []) s.delete(t)
  for (const t of fehlgeschlagen || []) if (t) s.add(String(t))
  return [...s].sort()
}

/**
 * Reparaturkandidaten: Fehlschlaege dieses Laufs plus die Luecken des vorigen
 * Vermerks, beide nur fuer Ziele, die dieser Lauf kennt. Was dieser Lauf schon
 * wegen seiner GROESSE verloren hat, wird nicht noch einmal geholt: derselbe
 * Proxy lehnt es byte-gleich wieder ab. Die Kategorie dafuer gibt der Aufrufer
 * mit (INSTALL_ERROR.TOOLARGE), damit sie an genau einer Stelle steht.
 */
export function reparaturKandidaten({ assets, fehler, vorigeLuecken, hoffnungslosKategorie, erledigt = null }) {
  const hoffnungslos = new Set((fehler || []).filter(f => f.category === hoffnungslosKategorie).map(f => f.target))
  const nachZiel = new Map((assets || []).map(a => [a.target, a]))
  // Eine vorige Luecke, die dieser Lauf schon uebertragen hat, ist geschlossen:
  // sie noch einmal zu holen kostete einen zweiten Download und Upload und
  // zaehlte faelschlich als "repaired". Fehlschlaege DIESES Laufs gelten immer.
  const schonDa = (t) => !!erledigt && erledigt.has(t)
  const out = new Map()
  const vorige = (Array.isArray(vorigeLuecken) ? vorigeLuecken : []).filter(t => !schonDa(t))
  for (const t of [...(fehler || []).map(f => f.target), ...vorige]) {
    if (hoffnungslos.has(t) || out.has(t)) continue
    const a = nachZiel.get(t)
    if (a) out.set(t, a)
  }
  return [...out.values()]
}
