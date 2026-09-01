import { BeneosUtility } from "./beneos_utility.js"
import { BeneosCloudLogin } from "./beneos_cloud.js"

/********************************************************************************** */
//const tokenDBURL = "https://www.beneos-database.com/data/tokens/beneos_tokens_database.json"
const tokenDBURL = "https://www.beneos-database.com/data/tokens/beneos_tokens_database_v2.json"
const battlemapDBURL = "https://www.beneos-database.com/data/battlemaps/beneos_battlemaps_database.json"
const itemDBURL = "https://www.beneos-database.com/data/items/beneos_items_database.json"
const spellDBURL = "https://www.beneos-database.com/data/spells/beneos_spells_database.json"
const commonDBURL = "https://www.beneos-database.com/data/common/beneos_common_database.json"
const i18nMatrixURL = "https://www.beneos-database.com/data/common/beneos_i18n.json"

// Wiederholung und Zeitdeckel je Katalogdatei. Drei Versuche kosten auf einer
// wirklich toten Verbindung hoechstens rund 3,3 Sekunden zusaetzlich und retten
// dafuer jeden kurzen Haenger. Ohne Zeitdeckel galt hier bisher der Vorgabewert
// von Foundry, den das Modul nirgends belegt und deshalb auch nicht kennt.
const DB_VERSUCHE = 3
const DB_PAUSEN_MS = [800, 2500]
const DB_ZEITDECKEL_MS = 15000

// Takt, der einen Katalogausfall von selbst wieder einsammelt. Dieselben Werte
// wie beim Serverwaechter in beneos_cloud.js, damit sich beide gleich anfuehlen.
const KATALOG_PROBE_START_MS = 60000
const KATALOG_PROBE_DECKEL_MS = 600000

/********************************************************************************** */
export class BeneosModuleMenu extends Dialog {

  /********************************************************************************** */
  constructor(html, tokenList, actor, x, y, template) {

    let myButtons = {
    }

    // Common conf
    let dialogConf = { content: html, title: "Beneos Tokens List", buttons: myButtons };
    let dialogOptions = { classes: ["beneos-actor-menu", "draggable"], left: x + 60, top: y + 20, width: 382, height: 520, 'z-index': 99999 }
    super(dialogConf, dialogOptions)

    this.actor = actor
    this.tokenList = tokenList
    this.listTemplate = template
  }
  /********************************************************************************** */
  async displayResults(beneosTokensHUD, searchValue = "") {
    if (beneosTokensHUD.length == 0) {
      beneosTokensHUD.push({ name: "No results" })
    }

    BeneosUtility.debugMessage("SEARCH results", beneosTokensHUD)
    let html = await renderTemplate('modules/beneos-module/templates/' + this.listTemplate,
      { beneosBasePath: BeneosUtility.getBasePath(), beneosDataPath: BeneosUtility.getFullPathWithSlash(), beneosTokensHUD, searchValue })
    this.data.content = html
    this.render(true)
  }

  /********************************************************************************** */
  textSearch(searchValue) {
    let newList = this.tokenList.filter(t => t.name.toLowerCase().includes(searchValue.toLowerCase()))
    return newList
  }

  /********************************************************************************** */
  processTextSearch(event) {
    BeneosUtility.debugMessage("Processing text search", event.currentTarget.value)
    let code = event.keyCode ? event.keyCode : event.which
    if (code == 13) {  // Enter keycode
      return
    }
    if (event.currentTarget.value && event.currentTarget.value.length >= 3) {
      let results = this.textSearch(event.currentTarget.value)
      this.displayResults(results, event.currentTarget.value)
    } else {
      this.displayResults(this.tokenList, event.currentTarget.value)
    }
  }

  /********************************************************************************** */
  activateListeners() {

    let myObject = this
    $(".beneos-actor-menu .beneos-search-token-text").keyup(event => {
      let code = event.keyCode ? event.keyCode : event.which
      if (code == 13) {  // Enter keycode
        event.preventDefault()
        return
      }
      clearTimeout(myObject.timeout)
      myObject.timeout = setTimeout(function () {
        myObject.processTextSearch(event)
      }, 600)
    })

    $(".beneos-actor-menu .beneos-button-select").click(async event => {
      let fullKey = $(event.currentTarget).data("full-key")
      let tokenData = BeneosUtility.getTokenDataFromKey(fullKey)

      let myActor = this.actor
      await myActor.update({ 'img': tokenData.avatar })
      // Mit der Textur wandern auch Scale und Anchor mit. Vorher wurde
      // nur texture.src getauscht, sodass ein hier zugewiesener
      // Beneos-Token auf der alten Groesse des Ziel-Actors sitzenblieb.
      const profile = BeneosUtility.getBeneosRenderProfile(myActor, tokenData.token)
      const texturePatch = {
        src: tokenData.token,
        scaleX: profile.scale, scaleY: profile.scale,
        anchorX: profile.anchorX, anchorY: profile.anchorY
      }
      const stamp = BeneosUtility.beneosRenderStamp(profile)
      if (myActor.token) {
        await myActor.token.update({
          texture: texturePatch,
          flags: { [BeneosUtility.moduleID()]: { renderStamp: stamp } }
        }, { beneosRenderSync: true })
      }
      await myActor.prototypeToken.update({ texture: texturePatch }, { beneosRenderSync: true })
      await myActor.setFlag(BeneosUtility.moduleID(), "renderStamp", stamp)
    })
  }
}

/********************************************************************************** */
export class BeneosDatabaseHolder {

  /********************************************************************************** */
  static async loadDatabaseFiles() {
    let localStorage = BeneosUtility.getLocalStorage()
    this.isOffline = false
    this._wiederholungAufgebraucht = false

    // Feature A: the six DB JSONs load through one helper (#loadOneDb) that adds
    // a local-cache + offline layer:
    //  - When the browser is offline we skip the doomed network round-trip and
    //    use the persisted copy immediately (no timeout wait).
    //  - Online we keep cache:"no-cache", which REVALIDATES against the CDN's
    //    ETag/Last-Modified: an unchanged DB comes back as a tiny 304 with the
    //    body served from the browser cache (server relief, no re-download),
    //    while a newer DB is pulled fresh , exactly "use local until a newer one
    //    is available". Any failure falls back to the persisted copy + isOffline.
    // The persisted copy lives in the world-scoped `beneos-database-local-storage`
    // setting (BeneosUtility.get/saveLocalStorage), same store as before.
    await this.#loadOneDb(tokenDBURL, "tokenData", localStorage, {
      notifLocal: "BENEOS.Notifications.Search.TokenDbLocal",
      notifError: (err) => game.i18n.format("BENEOS.Notifications.Search.TokenDbError", { message: err?.message, url: tokenDBURL }),
    })
    await this.#loadOneDb(battlemapDBURL, "bmapData", localStorage, {
      notifLocal: "BENEOS.Notifications.Search.BattlemapDbLocal",
      notifError: "BENEOS.Notifications.Search.BattlemapDbError",
    })
    await this.#loadOneDb(itemDBURL, "itemData", localStorage, {
      notifLocal: "BENEOS.Notifications.Search.ItemDbLocal",
      notifError: "BENEOS.Notifications.Search.ItemDbError",
    })
    await this.#loadOneDb(spellDBURL, "spellData", localStorage, {
      notifLocal: "BENEOS.Notifications.Search.SpellDbLocal",
      notifError: "BENEOS.Notifications.Search.SpellDbError",
    })
    await this.#loadOneDb(commonDBURL, "commonData", localStorage, {
      notifLocal: "BENEOS.Notifications.Search.CommonDbLocal",
      notifError: "BENEOS.Notifications.Search.CommonDbError",
    })
    // The catalogs were just replaced, so the memoised "newest release date per
    // catalog" that decides the NEW chip is stale. Clearing it here is what
    // makes a fresh release show up without a Foundry restart.
    this.beneosResetNewestReleaseMs()
    // Controlled-vocabulary tag-translation matrix (biomes, schools, rarities,
    // origins, ...). Best-effort: a failure here must not break the DB load;
    // the localizeTag helper falls back to the raw value when it is absent. No
    // error toast, and the lazy lowercase index is reset via resetI18n.
    await this.#loadOneDb(i18nMatrixURL, "i18nMatrix", localStorage, { resetI18n: true, bestEffort: true })

    BeneosUtility.saveLocalStorage(localStorage)

    this.buildSearchData()

    // Bis 14.4.7 blieb der Offline-Zustand die ganze Sitzung stehen: zurueckgesetzt
    // wurde er nur hier, und hier lief genau einmal, im ready-Hook. Ein Kunde mit
    // einem einzigen Netzhaenger sah danach jede Karte als offline, bis er die Welt
    // neu lud. Jetzt versucht es der Takt von selbst weiter.
    if (this.isOffline) this.starteKatalogProbe()
  }

  /********************************************************************************** */
  // Wiederholt den Katalogabruf, solange er scheitert, und hoert von selbst auf,
  // sobald er gelingt.
  //
  // Bauart absichtlich dieselbe wie BeneosCloud.startServerProbeLoop() fuer die
  // Serverseite: bei einer Minute anfangen, verdoppeln, bei zehn Minuten deckeln.
  // Ein zweites Muster fuer dasselbe Problem waere eine Kopie zu viel.
  static starteKatalogProbe() {
    if (this._katalogProbeLaeuft) return
    this._katalogProbeLaeuft = true
    this._katalogProbeMs = KATALOG_PROBE_START_MS

    const takt = async () => {
      if (!this.isOffline) { this._katalogProbeLaeuft = false; return }
      await this.erneutVersuchen({ still: true })
      if (!this.isOffline) {
        this._katalogProbeLaeuft = false
        return
      }
      this._katalogProbeMs = Math.min(this._katalogProbeMs * 2, KATALOG_PROBE_DECKEL_MS)
      setTimeout(takt, this._katalogProbeMs)
    }
    setTimeout(takt, this._katalogProbeMs)
  }

  /********************************************************************************** */
  // Laedt den Katalog neu und zeichnet das Cloud-Fenster nach, damit die Offline-
  // Anzeige verschwindet, ohne dass jemand die Welt neu laedt. Haengt am Knopf in
  // der Fusszeile und am Takt oben.
  static async erneutVersuchen({ still = false } = {}) {
    await this.loadDatabaseFiles()
    if (!this.isOffline) this._katalogProbeLaeuft = false
    if (!still) {
      const schluessel = this.isOffline
        ? "BENEOS.Cloud.Footer.RetryFailed"
        : "BENEOS.Cloud.Footer.RetryOk"
      try { ui.notifications?.[this.isOffline ? "warn" : "info"]?.(game.i18n.localize(schluessel)) } catch (_) {}
    }
    try { game.beneos?.cloudWindowV2?.render?.(false) } catch (_) {}
    return !this.isOffline
  }

  /********************************************************************************** */
  // Feature A: load one DB JSON with a local-cache + offline layer. Sets
  // this[prop] to the loaded (or cached) data and mirrors it into the persisted
  // `store` blob. opts: { notifLocal, notifError, resetI18n }.
  //  - notifLocal : i18n key shown (info) when we fall back to the local copy.
  //  - notifError : i18n key OR (err)=>string shown (error) when there is no
  //                 local copy to fall back to. Omit for best-effort DBs.
  //  - resetI18n  : also clear the lazy lowercase i18n index on (re)load.
  //  - bestEffort : a failure here must NOT put the whole window into the offline
  //                 state. For DBs the UI does not depend on, see the i18n matrix.
  static async #loadOneDb(url, prop, store, opts = {}) {
    const cached = store[prop]
    const useCache = () => {
      this[prop] = structuredClone(cached)
      // A best-effort DB does not own the offline state. Before 14.4.8 it did.
      // The i18n matrix is a purely cosmetic tag-translation table, loaded
      // without any notification, and it could put the entire cloud window
      // offline for a whole session without printing a single line anywhere.
      if (!opts.bestEffort) this.isOffline = true
      if (opts.resetI18n) this._i18nLcIndex = null
      if (opts.notifLocal) ui.notifications.info(game.i18n.localize(opts.notifLocal))
    }

    // Offline: skip the network entirely and use the persisted copy.
    if (typeof navigator !== "undefined" && navigator.onLine === false && cached) {
      useCache()
      return
    }

    // One attempt used to be the whole story: a single hiccup of one second cost
    // the user the rest of their session, because nothing ever retried and the
    // offline state only cleared on a page reload. Three attempts with a growing
    // pause cost at most ~3.3s on a genuinely dead link and survive a hiccup.
    // Gemessen am 2026-08-30 in Foundry V13: bei totem Katalog kostete die
    // Wiederholung ueber alle sechs Dateien 20,3 Sekunden, und der Weltstart
    // wartet darauf. Wenn die erste Datei ihre Versuche erschoepft hat, ist die
    // Verbindung meist weg statt nur kurz gestoert, und die uebrigen fuenf muessen das
    // nicht noch einmal beweisen. Damit bleibt der Schutz gegen den kurzen
    // Haenger und der schlimmste Fall faellt auf rund 3,3 Sekunden.
    const versucheHier = this._wiederholungAufgebraucht ? 1 : DB_VERSUCHE
    let letzterFehler = null
    for (let versuch = 0; versuch < versucheHier; versuch++) {
      if (versuch > 0) await new Promise(r => setTimeout(r, DB_PAUSEN_MS[versuch - 1]))
      try {
        const data = await foundry.utils.fetchJsonWithTimeout(
          url,
          { cache: "no-cache", method: "GET", "Content-Type": "application/json" },
          { timeoutMs: DB_ZEITDECKEL_MS }
        )
        this[prop] = data
        store[prop] = structuredClone(data)
        if (opts.resetI18n) this._i18nLcIndex = null
        return
      } catch (err) {
        letzterFehler = err
      }
    }

    if (versucheHier > 1) this._wiederholungAufgebraucht = true

    if (cached) {
      useCache()
    } else if (opts.notifError) {
      const msg = typeof opts.notifError === "function"
        ? opts.notifError(letzterFehler)
        : game.i18n.localize(opts.notifError)
      ui.notifications.error(msg)
    } else {
      this[prop] = null
    }
  }

  /********************************************************************************** */
  // Localize a controlled-vocabulary tag value via the shared beneos_i18n matrix.
  // `domainField` is a field_map key (e.g. "token.biom", "item.rarity",
  // "spell.school"). Returns the translation for the active locale, falling back
  // to English, then to the raw value (so callers can still #capitalize it).
  // Never throws.
  static localizeTag(domainField, value) {
    const raw = String(value ?? "")
    try {
      const m = this.i18nMatrix
      if (!m || !m.field_map || !m.domains) return raw
      const catPath = m.field_map[domainField]
      if (!catPath) return raw
      const dot = catPath.indexOf(".")
      const dom = catPath.slice(0, dot), cat = catPath.slice(dot + 1)
      const bucket = m.domains?.[dom]?.[cat]
      if (!bucket) return raw
      let term = bucket[raw]
      if (!term) {
        // case-insensitive fallback (e.g. hardcoded "very rare" vs key "Very Rare")
        if (!this._i18nLcIndex) this._i18nLcIndex = {}
        const ck = dom + "." + cat
        let idx = this._i18nLcIndex[ck]
        if (!idx) {
          idx = {}
          for (const k in bucket) idx[k.toLowerCase()] = bucket[k]
          this._i18nLcIndex[ck] = idx
        }
        term = idx[raw.toLowerCase()]
      }
      if (!term) return raw
      return term[game.i18n.lang] || term.en || raw
    } catch (e) {
      return raw
    }
  }

  /********************************************************************************** */
  static getIsOffline() {
    return this.isOffline
  }

  /********************************************************************************** */
  static getHover(category, term) {
    if (!term || !category) return ""
    category = category.toString().toLowerCase()
    let termLow = term.toString().toLowerCase()
    if (this.commonData?.hover[category] && this.commonData.hover[category][termLow]?.message) {
      return this.commonData.hover[category][term].message
    }
    if (this.commonData?.hover[category] && this.commonData.hover[category][term.toString()]?.message) {
      return this.commonData.hover[category][term].message
    }
    return "No information"
  }

  /********************************************************************************** */
  static buildList(list) {
    let valueList = {}

    const sortObject = obj => Object.keys(obj).sort().reduce((res, key) => (res[key] = obj[key], res), {})

    if (list) {
      if (typeof (list) == "string" || typeof (list) == "number") {
        list = list.toString()
        if (!valueList[list]) {
          valueList[list] = 1
        } else {
          valueList[list]++
        }
        return sortObject(valueList)
      }
      if (Array.isArray(list)) {
        for (let key of list) {
          let keyStr = key.toString()
          if (!valueList[keyStr]) {
            valueList[keyStr] = 1
          } else {
            valueList[keyStr]++
          }
        }
      } else if (typeof (list) == "object") {
        for (let key in list) {
          let keyStr = list[key].toString()
          if (!valueList[keyStr]) {
            valueList[keyStr] = 1
          } else {
            valueList[keyStr]++
          }
        }
      }
    }
    return sortObject(valueList)
  }

  /********************************************************************************** */
  // Teil 4: unified New/Updated computation for token/item/spell. The single
  // place that decides which chip an asset carries; the Home rails read the
  // same answer, so rail and result list can no longer disagree.
  //
  //  - New: the asset is not installed AND it belongs to the newest published
  //    wave of its catalog, that is its release_date equals the newest
  //    release_date in that catalog.
  //  - Updated: it IS installed and the online version is newer than the local
  //    install, compared via the catalog updated_date against the local install
  //    date, with a content-signature mismatch as the fallback signal.
  //  - Neither otherwise. An asset that was quietly revised but never installed
  //    stays silent on purpose: an update is only news to someone who holds the
  //    older copy.
  //
  // "Newest wave" rather than a rolling window because the release cadence is
  // irregular. A window says nothing during a quiet month and lights up two
  // waves during a busy one; the wave rule always marks exactly what came last.
  //
  // There is deliberately NO fallback to the cloud updated_ts. It used to fill
  // in when release_date was missing, and that is what turned every revision
  // into a NEW chip. Without a publication date the honest answer is no chip.
  // (The old `ts > installTS` update check compared unix-seconds against
  // milliseconds and could never fire, so update relied solely on the hash
  // mismatch; the date comparison below is what actually makes time-based
  // updates work.)
  static beneosComputeNewUpdate(data, { type, installTS, cloudHash, installHash } = {}) {
    const props = data?.properties || {}
    const installed = data?.installed === "installed"
    let isNew = false, isUpdate = false

    if (!installed) {
      const relMs = this.beneosParseDateMs(props.release_date)
      const newestMs = this.beneosNewestReleaseMs(type)
      isNew = relMs != null && newestMs != null && relMs === newestMs
    } else {
      const updMs  = this.beneosParseDateMs(props.updated_date)
      // installTS is stored in seconds for tokens but in milliseconds for items
      // and spells; normalize to milliseconds (a real seconds timestamp is
      // < 1e12) so it compares like-for-like against the millisecond
      // updated_date. Without this a seconds install date is always smaller than
      // the millisecond catalog date, so every installed token read as "update
      // available" forever, even right after a successful install/update.
      let instMs = Number(installTS) || 0
      if (instMs > 0 && instMs < 1e12) instMs *= 1000
      if (updMs != null && instMs > 0 && updMs > instMs) isUpdate = true
      if (!isUpdate && cloudHash && installHash && cloudHash !== installHash) isUpdate = true
    }
    return { isNew, isUpdate }
  }

  /**
   * Newest release_date in a catalog, in milliseconds, or null when the catalog
   * carries no usable date at all.
   *
   * Read straight from the stored catalog rather than through getAll(), which
   * hands out a structuredClone of the whole category: cloning 700 entries to
   * find one maximum, once per card, would be the most expensive line in the
   * render. Memoised for the same reason, and cleared in loadDatabaseFiles(),
   * the only place a catalog is replaced.
   */
  static beneosNewestReleaseMs(type) {
    if (!this._newestReleaseMs) this._newestReleaseMs = {}
    if (this._newestReleaseMs[type] !== undefined) return this._newestReleaseMs[type]
    const source = type === "token" ? this.tokenData?.content
                 : type === "item"  ? this.itemData?.content
                 : type === "spell" ? this.spellData?.content
                 : type === "bmap"  ? this.bmapData?.content
                 : null
    let max = null
    for (const key in (source || {})) {
      const ms = this.beneosParseDateMs(source[key]?.properties?.release_date)
      if (ms != null && (max === null || ms > max)) max = ms
    }
    this._newestReleaseMs[type] = max
    return max
  }

  /** Forget the memoised newest dates. Called when a catalog is (re)loaded. */
  static beneosResetNewestReleaseMs() {
    this._newestReleaseMs = {}
  }

  static beneosParseDateMs(s) {
    const str = String(s || "").trim()
    if (!str) return null
    const ms = Date.parse(str)
    return Number.isFinite(ms) ? ms : null
  }

  /********************************************************************************** */
  static processInstalledToken(tokenData) {
    tokenData.isInstalled = BeneosUtility.isTokenLoaded(tokenData.key)
    tokenData.installed = (tokenData.isInstalled) ? "installed" : "notinstalled"
    tokenData.isCloudAvailable = false
    tokenData.isNew = false
    tokenData.isUpdate = false

    if (tokenData.installed == "notinstalled") {
      tokenData.isCloudAvailable = game.beneos.cloud.isTokenAvailable(tokenData.key)
      if (!tokenData.isCloudAvailable
          && game.beneos.cloud.isFreeAsset?.("token", tokenData.key) === true
          && game.beneos.cloud.isLoggedIn?.()) {
        tokenData.isCloudAvailable = true
      }
      tokenData.installed = (tokenData.isCloudAvailable) ? "cloudavailable" : tokenData.installed
    }
    tokenData.cloudMessage = (tokenData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    tokenData.isInstallable = (tokenData.isInstalled || tokenData.isCloudAvailable)

    tokenData.dragMode = "none"
    if (tokenData.isCloudAvailable) {
      tokenData.dragMode = "cloud"
    } else if (tokenData.isInstalled) {
      tokenData.dragMode = "local"
    }

    // Prepare update/new status (Teil 4: unified release_date / updated_date)
    tokenData.isNewForUser = !!game.beneos.cloud.getTokenIsNewForUser(tokenData.key)
    {
      const f = this.beneosComputeNewUpdate(tokenData, {
        type:        "token",
        installTS:   BeneosUtility.getTokenInstallTS(tokenData.key),
        cloudHash:   game.beneos.cloud.getTokenHash(tokenData.key),
        installHash: BeneosUtility.getTokenInstallHash(tokenData.key),
      })
      tokenData.isNew = f.isNew
      tokenData.isUpdate = f.isUpdate
    }

    tokenData.properties.install = ["Any", "All"] // Used for filtering
    if (tokenData.isNew) {
      tokenData.properties.install.push("New")
    }
    if (tokenData.isNewForUser) {
      tokenData.properties.install.push("NewForYou")
    }
    if (tokenData.isUpdate) {
      tokenData.properties.install.push("Updated")
    }
  }

  /********************************************************************************** */
  static processInstalledItem(itemData) {
    itemData.isInstalled = BeneosUtility.isItemLoaded(itemData.key)
    itemData.installed = (itemData.isInstalled) ? "installed" : "notinstalled"
    itemData.isCloudAvailable = false
    if (itemData.installed === "notinstalled") {
      itemData.isCloudAvailable = game.beneos.cloud.isItemAvailable(itemData.key)
      // Free items are always cloud-available for logged-in users. Free status
      // comes from the cloud "Free" tier (data.free), the single dynamic source
      // of truth — not the stale catalog free_content flag.
      if (!itemData.isCloudAvailable
          && game.beneos.cloud.isFreeAsset?.("item", itemData.key) === true
          && game.beneos.cloud.isLoggedIn?.()) {
        itemData.isCloudAvailable = true
      }
      itemData.installed = (itemData.isCloudAvailable) ? "cloudavailable" : itemData.installed
    }
    itemData.cloudMessage = (itemData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    itemData.isInstallable = (itemData.isInstalled || itemData.isCloudAvailable)

    // Prepare update/new status (Teil 4: unified release_date / updated_date)
    itemData.isNewForUser = !!game.beneos.cloud.getItemIsNewForUser(itemData.key)
    {
      const f = this.beneosComputeNewUpdate(itemData, {
        type:        "item",
        installTS:   BeneosUtility.getItemInstallTS(itemData.key),
        cloudHash:   game.beneos.cloud.getItemHash(itemData.key),
        installHash: BeneosUtility.getItemInstallHash(itemData.key),
      })
      itemData.isNew = f.isNew
      itemData.isUpdate = f.isUpdate
    }
    itemData.properties.install = ["Any", "All"] // Used for filtering
    if (itemData.isNew) {
      itemData.properties.install.push("New")
    }
    if (itemData.isNewForUser) {
      itemData.properties.install.push("NewForYou")
    }
    if (itemData.isUpdate) {
      itemData.properties.install.push("Updated")
    }
    itemData.dragMode = "none"
    if (itemData.isCloudAvailable) {
      itemData.dragMode = "cloud"
    } else if (itemData.isInstalled) {
      itemData.dragMode = "local"
    } else {
      itemData.dragMode = "none"
    }
  }

  /********************************************************************************** */
  static processInstalledSpell(spellData) {
    spellData.isInstalled = BeneosUtility.isSpellLoaded(spellData.key)
    spellData.installed = (spellData.isInstalled) ? "installed" : "notinstalled"
    spellData.isCloudAvailable = false
    if (spellData.installed == "notinstalled") {
      spellData.isCloudAvailable = game.beneos.cloud.isSpellAvailable(spellData.key)
      if (!spellData.isCloudAvailable
          && game.beneos.cloud.isFreeAsset?.("spell", spellData.key) === true
          && game.beneos.cloud.isLoggedIn?.()) {
        spellData.isCloudAvailable = true
      }
      spellData.installed = (spellData.isCloudAvailable) ? "cloudavailable" : spellData.installed
    }
    spellData.cloudMessage = (spellData.isCloudAvailable) ? "Cloud available" : "Cloud not available"
    spellData.isInstallable = (spellData.isInstalled || spellData.isCloudAvailable)

    if (spellData.isInstalled) {
      //spellData.picture = BeneosUtility.getLocalAvatarPicture(spellData.key)
    }
    // Prepare update/new status (Teil 4: unified release_date / updated_date)
    spellData.isNewForUser = !!game.beneos.cloud.getSpellIsNewForUser(spellData.key)
    {
      const f = this.beneosComputeNewUpdate(spellData, {
        type:        "spell",
        installTS:   BeneosUtility.getSpellInstallTS(spellData.key),
        cloudHash:   game.beneos.cloud.getSpellHash(spellData.key),
        installHash: BeneosUtility.getSpellInstallHash(spellData.key),
      })
      spellData.isNew = f.isNew
      spellData.isUpdate = f.isUpdate
    }
    spellData.properties.install = ["Any", "All"] // Used for filtering
    if (spellData.isNew) {
      spellData.properties.install.push("New")
    }
    if (spellData.isNewForUser) {
      spellData.properties.install.push("NewForYou")
    }
    if (spellData.isUpdate) {
      spellData.properties.install.push("Updated")
    }
    spellData.dragMode = "none"
    if (spellData.isCloudAvailable) {
      spellData.dragMode = "cloud"
    } else if (spellData.isInstalled) {
      spellData.dragMode = "local"
    } else {
      spellData.dragMode = "none"
    }
  }

  /********************************************************************************** */
  static getTokenDatabaseInfo(key) {
    return this.tokenData.content[key]
  }

  /********************************************************************************** */
  static buildTypeACHPString(properties) {
    if (!properties.type || properties.type.length == 0) {
      properties.typeString = ""
      return
    }
    let typeString = properties.type[0].charAt(0).toUpperCase() + properties.type[0].slice(1)
    // For each type above the first, put them into (), comma separated
    if (properties.type.length > 1) {
      typeString += " ("
      for (let i = 1; i < properties.type.length; i++) {
        if (i > 1) {
          typeString += ", "
        }
        // Uppercase first letter
        typeString += properties.type[i].charAt(0).toUpperCase() + properties.type[i].slice(1)
      }
      typeString += ")"
    }
    properties.typeString = typeString
  }

  /********************************************************************************** */
  static buildSearchData() {
    this.tokenTypes = {}
    this.tokenBioms = {}
    this.tokenFactions = {}
    this.tokenCampaigns = {}
    this.tokenSources = {}
    this.bmapBioms = {}
    this.fightingStyles = {}
    this.bmapBrightness = {}
    this.crList = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "0,4", value: "0 to 4" }, { key: "5,10", value: "5 to 10" }, { key: "11,15", value: "11 to 15" },
    { key: "15,10000000", value: "15+" }]
    this.movementList = {}
    this.purposeList = {}
    this.hiddenTagsList = {}
    this.gridList = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "<150", value: "Tiny" }, { key: "<500", value: "Small" }, { key: "<1000", value: "Medium" },
    { key: "<2000", value: "Big" }, { key: ">2000", value: "Very Big" }]
    this.adventureList = {}
    this.itemRarity = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "common", value: "    Common" }, { key: "uncommon", value: "   Uncommon" }, { key: "rare", value: "  Rare" }, { key: "very rare", value: " Very Rare" }, { key: "legendary", value: "Legendary" }]
    this.itemOrigin = {}
    this.itemType = {}
    this.itemTier = {}
    this.itemPrice = [{ key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") }, { key: "<100", value: "< 100g" }, { key: "<1000", value: "< 1000g" }, { key: "<5000", value: "< 5000g" },
    { key: "<15000", value: "< 15.000g" }, { key: ">15000", value: "> 15.000g" }]
    this.spellLevel = {}
    this.spellSchool = {}
    this.spellCastingTime = {}
    this.spellType = {}
    this.spellClasses = {}

    for (let key in this.tokenData.content) {
      //BeneosUtility.debugMessage("Processing", key)
      let tokenData = this.tokenData.content[key]
      if (tokenData && typeof (tokenData) == "object") {
        tokenData.kind = "token"
        tokenData.key = key
        tokenData.picture = "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + tokenData.properties.thumbnail
        foundry.utils.mergeObject(this.tokenBioms, this.buildList(tokenData.properties.biom))
        foundry.utils.mergeObject(this.tokenFactions, this.buildList(tokenData.properties.faction))
        foundry.utils.mergeObject(this.tokenSources, this.buildList(tokenData.properties.source))
        foundry.utils.mergeObject(this.tokenTypes, this.buildList(tokenData.properties.type))
        foundry.utils.mergeObject(this.fightingStyles, this.buildList(tokenData.properties.fightingstyle))
        foundry.utils.mergeObject(this.movementList, this.buildList(tokenData.properties.movement))
        foundry.utils.mergeObject(this.purposeList, this.buildList(tokenData.properties.purpose))
        foundry.utils.mergeObject(this.tokenCampaigns, this.buildList(tokenData.properties.campaign))
        this.processInstalledToken(tokenData)
        this.buildTypeACHPString(tokenData.properties)
        tokenData.factionText = tokenData.properties?.faction?.[0] || ""
        if (tokenData.installed === "notinstalled") {
          continue; // Skip the rest of the processing if not installed (ie only cloud/installed listing)
        }

        tokenData.nbVariants = tokenData.properties.nb_variants || 1
        tokenData.actorId = BeneosUtility.getActorId(key)
        tokenData.description = tokenData.description
        if (tokenData.nbVariants > 0) {
          tokenData.variantClass = "beneos-search-icons-result-tooltip-variant-3"
          if (tokenData.nbVariants == 1) {
            tokenData.variantClass = "beneos-search-icons-result-tooltip-variant-1"
          }
          if (tokenData.nbVariants == 2) {
            tokenData.variantClass = "beneos-search-icons-result-tooltip-variant-2"
          }
          tokenData.variantList = []
          for (let i = 1; i <= tokenData.nbVariants; i++) {
            let variant = {
              thumbnail: "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + tokenData.key + "-" + i + "-db.webp",
              actorId: BeneosUtility.getActorIdVariant(key, i),
            }
            tokenData.variantList.push(variant)
          }
        }
      }
    }

    for (let key in this.bmapData.content) {
      let bmapData = this.bmapData.content[key]
      if (bmapData && typeof (bmapData) == "object") {
        // Make uppercase first letter to all words in the name string
        bmapData.name = bmapData.name.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
        bmapData.kind = "battlemap"
        bmapData.key = key
        bmapData.picture = "https://www.beneos-database.com/data/battlemaps/thumbnails/" + bmapData.properties.thumbnail
        foundry.utils.mergeObject(this.bmapBrightness, this.buildList(bmapData.properties.brightness))
        foundry.utils.mergeObject(this.bmapBioms, this.buildList(bmapData.properties.biom))
        foundry.utils.mergeObject(this.adventureList, this.buildList(bmapData.properties.adventure))
        bmapData.isInstalled = true
      }
    }
    for (let key in this.bmapData.content) {
      let bmapData = this.bmapData.content[key]
      if (bmapData && typeof (bmapData) == "object") {
        if (bmapData.properties.sibling) {
          bmapData.siblingPicture = this.getSiblingPicture(bmapData.properties.sibling)
        }
      }
    }

    for (let key in this.itemData.content) {
      let itemData = this.itemData.content[key]
      if (itemData && typeof (itemData) == "object") {
        // The catalog key is turned into its dashed form for the id lookups
        // below, but the folder on disk keeps the underscore. Hold on to the
        // untouched slug, the card paths need it.
        const slug = key
        if (/^\d+_/.test(key)) {
          key = key.replace(/^(\d+)_/, '$1-');
        }
        itemData.kind = "item"
        itemData.key = key
        itemData.path_name = itemData.name.replace(/ /g, "_").toLowerCase()
        itemData.picture = "https://www.beneos-database.com/data/items/thumbnails/" + itemData.properties.icon
        foundry.utils.mergeObject(this.itemRarity, this.buildList(itemData.properties.rarity))
        foundry.utils.mergeObject(this.itemOrigin, this.buildList(itemData.properties.origin))
        foundry.utils.mergeObject(this.itemType, this.buildList(itemData.properties.item_type))
        foundry.utils.mergeObject(this.itemTier, this.buildList(itemData.properties.tier))
        this.processInstalledItem(itemData)
        if (itemData.isInstalled) {
          itemData.itemId = BeneosUtility.getItemId(key)
          // Cloud namespace, not the authoring one. getBeneosItemDataPath()
          // resolves to beneos_assets/beneos_items/, which only exists on an
          // authoring machine; the installer writes to beneos_assets/cloud/
          // items/. Together with the dashed key this preview pointed at a
          // folder no customer has ever had.
          itemData.card_front = `beneos_assets/cloud/items/${slug}/${slug}-front.webp`
          itemData.card_back = `beneos_assets/cloud/items/${slug}/${slug}-back.webp`
        }
      }
    }

    for (let key in this.spellData.content) {
      let spellData = this.spellData.content[key]
      if (spellData && typeof (spellData) == "object") {
        const slug = key
        if (/^\d+_/.test(key)) {
          key = key.replace(/^(\d+)_/, '$1-');
        }
        spellData.kind = "spell"
        spellData.key = key
        spellData.path_name = spellData.name.replace(/ /g, "_").toLowerCase()
        spellData.picture = "https://www.beneos-database.com/data/spells/thumbnails/" + spellData.properties.icon
        foundry.utils.mergeObject(this.spellLevel, this.buildList(spellData.properties.level))
        foundry.utils.mergeObject(this.spellSchool, this.buildList(spellData.properties.school))
        foundry.utils.mergeObject(this.spellCastingTime, this.buildList(spellData.properties.casting_time))
        foundry.utils.mergeObject(this.spellType, this.buildList(String(spellData.properties.spell_type)))
        foundry.utils.mergeObject(this.spellClasses, this.buildList(spellData.properties.classes))
        this.processInstalledSpell(spellData)
        if (spellData.isInstalled) {
          spellData.spellId = BeneosUtility.getSpellId(key)
          // Same two fixes as the item block above, plus a third: the back
          // used to be the shared spell_card_back.webp from the spells root.
          // That is the old card architecture. Every spell carries its own
          // back today, and the shared file is never uploaded to a customer.
          spellData.card_front = `beneos_assets/cloud/spells/${slug}/${slug}-front.webp`
          spellData.card_back = `beneos_assets/cloud/spells/${slug}/${slug}-back.webp`
        }
      }
    }
  }

  /********************************************************************************** */
  static fieldTextSearch(item, text) {
    // Split text in words, ignore words smaller than 3 letters
    let words = text.split(" ").filter(word => word.length >= 3)
    if (words.length == 0) {
      return false
    }
    // Search each word in all fields
    for (let word of words) {
      for (let field in item) {
        let value = item[field]
        if (field == "description") {
          continue
        }
        if (typeof (value) == "string") {
          if (value.toLowerCase().includes(word)) {
            return true
          }
        } else if (Array.isArray(value)) {
          for (let arrayValue of value) {
            if (typeof (arrayValue) == "string" && arrayValue.toLowerCase().includes(word)) {
              return true
            }
          }
        }
      }
    }
    return false
  }

  /********************************************************************************** */
  static getTagDescriptions() {
    return structuredClone(this.tokenData.tag_description)
  }

  /********************************************************************************** */
  static getTagDescription(tagName) {
    if (this.tokenData.tag_description) {
      let tag = this.tokenData.tag_description[tagName.toLowerCase()]
      if (tag) {
        return tag.description
      }
    }
    return "No information"
  }

  /********************************************************************************** */
  static objectTextSearch(objectList, text, kind) {
    let results = []

    text = text.toLowerCase()

    for (let key in objectList) {
      let item = structuredClone(objectList[key])
      item.kind = kind || "token"
      if (item.kind == "token") {
        item.kind = (kind == "token") ? "token" : item.properties.type
      }
      if (kind && kind == "item") {
        item.picture = "https://www.beneos-database.com/data/items/thumbnails/" + item.properties.icon
      } else if (kind && kind == "spell") {
        item.picture = "https://www.beneos-database.com/data/spells/thumbnails/" + item.properties.icon
      } else if (item.kind == "token") {
        item.picture = "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + item.properties.thumbnail
      } else {
        item.kind = "battlemap"
        item.picture = "https://www.beneos-database.com/data/battlemaps/thumbnails/" + item.properties.thumbnail
      }
      if (this.fieldTextSearch(item, text) || this.fieldTextSearch(item.properties, text)) {
        results.push(item)
      }
    }
    return results
  }

  /********************************************************************************** */
  static textSearch(text, mode) {
    BeneosUtility.debugMessage("TEXT search", text, mode)
    let results = []
    if (mode == "token") {
      results = this.objectTextSearch(this.tokenData.content, text, "token")
    }
    if (mode == "bmap") {
      results = results.concat(this.objectTextSearch(this.bmapData.content, text, "bmap"))
    }
    if (mode == "item") {
      results = results.concat(this.objectTextSearch(this.itemData.content, text, "item"))
    }
    if (mode == "spell") {
      results = results.concat(this.objectTextSearch(this.spellData.content, text, "spell"))
    }

    BeneosUtility.debugMessage("TEXT search results", results)
    return results
  }

  /********************************************************************************** */
  static getSiblingPicture(key) {
    let sibling = this.bmapData.content[key]
    if (sibling) {
      return "https://www.beneos-database.com/data/battlemaps/thumbnails/" + sibling.properties.thumbnail
    }
    BeneosUtility.debugMessage("No relevant sibling picture found for", key)
    return undefined
  }

  /********************************************************************************** */
  static searchByProperty(type, propertyName, value, searchResults, strict = false) {
    let newResults = {}
    value = value.toLowerCase()

    BeneosUtility.debugMessage(">>>>>", type, propertyName, value, searchResults)

    for (let key in searchResults) {
      let item = searchResults[key]
      item.kind = type
      if (type == "bmap" || type == "battlemap") {
        item.kind = "battlemap"
      }
      if (item.kind == "token") {
        item.picture = "https://www.beneos-database.com/data/tokens/thumbnails_v2/" + item.properties.thumbnail
      }
      if (item[propertyName]) {
        if (item[propertyName].toLowerCase() == value) {
          newResults[key] = structuredClone(item)
        }
      }
      if (propertyName == "grid") {
        let comp = value.substring(0, 1)
        let grid = parseInt(value.substring(1))
        let sizeParse = item.properties.grid.match(/(\d+)\s*x\s*(\d+)/)
        if (sizeParse?.[1] && sizeParse?.[2]) {
          let size = parseInt(sizeParse[1]) * parseInt(sizeParse[2])
          if ((comp == "<" && Number(size) <= Number(grid)) || (comp == ">" && Number(size) >= Number(grid))) {
            newResults[key] = structuredClone(item)
          }
        }
      } else if (propertyName == "cr") {
        let comp = value.match(/(\d+),(\d+)/)
        if (comp?.[1] && comp?.[2]) {
          if (item.properties.cr >= Number(comp[1]) && (item.properties.cr <= Number(comp[2]))) {
            newResults[key] = structuredClone(item)
          }
        } else if (item.properties.cr == Number(value)) {
          newResults[key] = structuredClone(item)
        }

      } else if (propertyName == "price") {
        let comp = value.substring(0, 1)
        let price = parseInt(value.substring(1))
        if ((comp == "<" && item.properties.price <= price) || (comp == ">" && item.properties.price > price)) {
          newResults[key] = structuredClone(item)
        }
      } else if (item?.properties[propertyName] != null) {
        // F6: a truthy check dropped numeric rarity 0 (Common), so Common items
        // never surfaced in the rarity filter. Guard on != null so 0 (and other
        // falsy-but-present values) still match; empty strings fall through the
        // string branch harmlessly.
        if (typeof (item.properties[propertyName]) == "string" || typeof (item.properties[propertyName]) == "number") {
          if (strict) {
            if (item.properties[propertyName].toString().toLowerCase() == value.toString()) {
              newResults[key] = structuredClone(item)
            }
          } else {
            if (item.properties[propertyName].toString().toLowerCase().includes(value)) {
              newResults[key] = structuredClone(item)
            }
          }
        } else {
          if (Array.isArray(item.properties[propertyName])) {
            for (let valueArray of item.properties[propertyName]) {
              if ((typeof (valueArray) == "string") && valueArray.toString().toLowerCase().includes(value)) {
                newResults[key] = structuredClone(item)
              }
            }
          }
        }
      }
    }
    BeneosUtility.debugMessage("Found", newResults)
    return newResults
  }

  /********************************************************************************** */
  static getAll(type) {
    if (type == "token") {
      return structuredClone(this.tokenData.content)
    }
    if (type == "item") {
      return structuredClone(this.itemData.content)
    }
    if (type == "spell") {
      return structuredClone(this.spellData.content)
    }
    return structuredClone(this.bmapData.content)
  }

  /********************************************************************************** */
  static sortProperties(tab) {
    // Check if tab is an array
    if (!Array.isArray(tab)) {
      return tab
    }
    if (tab.length > 0) {
      if (Number(tab[0].key)) {
        return tab.sort(function (a, b) {
          if (!Number(a.key) || !Number(b.key)) {
            return 0;
          }
          if (Number(a.key) > Number(b.key)) {
            return 1;
          }
          return -1;
        })
      }
      if (tab[0].key[0] == "<" || tab[0].key[0] == ">") {
        let a1 = Number(a.key.slice(1))
        let b1 = Number(b.key.slice(1))
        if (a1 > b1) return 1;
        return -1;
      }
    }
    return tab.sort(function (a, b) { return a.value.localeCompare(b.value) })
  }

  /********************************************************************************** */
  static toTable(object) {
    let tab = []
    for (let key in object) {
      key = String(key)
      if (tab.find((it) => it.key == key.toLowerCase()) == undefined) {
        tab.push({ key: key.toLowerCase(), value: key })
      }
    }
    tab = BeneosDatabaseHolder.sortProperties(tab)
    if (tab.find((it) => it.key.toLowerCase() == "any") == undefined) {
      tab.splice(0, 0, { key: "any", value: game.i18n.localize("BENEOS.Cloud.Filter.Any") })
    }

    return tab
  }

  /********************************************************************************** */
  static getBattlemap(key) {
    return this.bmapData.content[key]
  }

  /********************************************************************************** */
  static getData() {
    let mode = "token"
    if (game.beneosTokens.lastFilterStack?.mode) {
      mode = game.beneosTokens.lastFilterStack.mode
    }

    return {
      searchMode: mode,

      tokenBioms: this.toTable(this.tokenBioms),
      bmapBioms: this.toTable(this.bmapBioms),
      tokenTypes: this.toTable(this.tokenTypes),
      tokenFactions: this.toTable(this.tokenFactions),
      tokenSources: this.toTable(this.tokenSources),
      tokenCampaigns: this.toTable(this.tokenCampaigns),
      fightingStyles: this.toTable(this.fightingStyles),
      bmapBrightness: this.toTable(this.bmapBrightness),
      movementList: this.toTable(this.movementList),
      crList: structuredClone(this.crList),
      purposeList: this.toTable(this.purposeList),
      adventureList: this.toTable(this.adventureList),
      gridList: BeneosDatabaseHolder.sortProperties(structuredClone(this.gridList)),

      rarity: this.toTable(this.itemRarity),
      origin: this.toTable(this.itemOrigin),
      itemType: this.toTable(this.itemType),
      tier: this.toTable(this.itemTier),
      price: BeneosDatabaseHolder.sortProperties(structuredClone(this.itemPrice)),

      level: this.toTable(this.spellLevel),
      school: this.toTable(this.spellSchool),
      castingTime: this.toTable(this.spellCastingTime),
      spellType: this.toTable(this.spellType),
      spellClass: this.toTable(this.spellClasses),

      isCloudLoggedIn: game.beneos.cloud.isLoggedIn(),
      patreonStatus: game.beneos.cloud.getPatreonStatus(),
    }
  }
}
