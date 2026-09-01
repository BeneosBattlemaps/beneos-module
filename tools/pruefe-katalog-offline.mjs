// Schritt 4 des Pruefablaufs fuer den Katalog-Offline-Fix.
//
// Faehrt die geaenderte Bedingung wirklich aus, statt sie nur im Quelltext zu
// suchen: Foundry-Globale werden gestellt, der Netzabruf wird gesteuert, und
// danach wird der Zustand gelesen. Ohne Foundry, ohne Netz, ohne Nebenwirkung.
//
// Aufruf aus der Wurzel des Moduls: node tools/pruefe-katalog-offline.mjs

const gestellteSpeicher = { store: {} }

// Node 22 bringt ein eigenes navigator mit, das nur einen Lesezugriff hat.
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true })
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } }

let fetchProtokoll = []
let fetchVerhalten = () => { throw new Error("Netz aus") }

// Die Importkette zieht Module mit, die beim Laden das DOM anfassen. Eine
// duenne Huelle genuegt; nichts davon wird geprueft.
const knoten = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
  appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {},
  querySelector: () => null, querySelectorAll: () => [], textContent: "", innerHTML: "",
})
globalThis.document = {
  createElement: knoten, createTextNode: knoten,
  head: knoten(), body: knoten(),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {},
}
globalThis.window = globalThis
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }

// Foundrys Basisklassen, die die Module beim Laden erweitern. Leere Huellen
// genuegen, geprueft wird keine davon.
class Leer { constructor() {} static get defaultOptions() { return {} } }
for (const name of ["FormApplication", "Application", "Dialog", "FilePicker",
                    "Actor", "Item", "Scene", "Token", "Hooks", "CONFIG"]) {
  if (globalThis[name] === undefined) globalThis[name] = Leer
}
globalThis.Hooks = { on() {}, once() {}, callAll() {}, call() {} }
globalThis.CONFIG = {}

globalThis.foundry = {
  applications: {
    api: { ApplicationV2: Leer, HandlebarsApplicationMixin: (B) => B },
    instances: {},
  },
  utils: {
    fetchJsonWithTimeout: async (url, data, opts) => {
      fetchProtokoll.push({ url, timeoutMs: opts?.timeoutMs })
      return fetchVerhalten(url)
    },
  },
}

globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k },
  settings: {
    get: () => gestellteSpeicher.store,
    set: (_m, _k, v) => { gestellteSpeicher.store = v },
  },
  beneos: {},
}

const wurzel = new URL("../", import.meta.url)
const { BeneosDatabaseHolder } = await import(new URL("scripts/beneos_search_engine.js", wurzel))

// Der Zwischenspeicher wird ueber BeneosUtility gelesen und geschrieben; beide
// werden hier ersetzt, damit der Lauf nichts anfasst und wiederholbar bleibt.
const { BeneosUtility } = await import(new URL("scripts/beneos_utility.js", wurzel))
BeneosUtility.getLocalStorage = () => gestellteSpeicher.store
BeneosUtility.saveLocalStorage = (v) => { gestellteSpeicher.store = v }

BeneosDatabaseHolder.buildSearchData = () => {}
BeneosDatabaseHolder.beneosResetNewestReleaseMs = () => {}
BeneosDatabaseHolder.starteKatalogProbe = () => {}   // Takt hier nicht mitlaufen lassen

const KATALOG = "beneos_i18n.json"
const faelle = []

async function fahre(name, verhalten, vorbefuellen) {
  gestellteSpeicher.store = vorbefuellen ? {
    tokenData: {}, bmapData: {}, itemData: {}, spellData: {}, commonData: {}, i18nMatrix: {},
  } : {}
  fetchProtokoll = []
  fetchVerhalten = verhalten
  BeneosDatabaseHolder.isOffline = false
  await BeneosDatabaseHolder.loadDatabaseFiles()
  faelle.push({ name, offline: BeneosDatabaseHolder.isOffline, abrufe: fetchProtokoll.length })
}

// Wert 1, aendert sich: nur die Sprachmatrix scheitert.
await fahre("nur die Sprachmatrix scheitert",
  (url) => { if (url.includes(KATALOG)) throw new Error("aus"); return { ok: true } }, true)

// Rueckfallprobe: eine echte Katalogdatei scheitert. Musste offline bleiben.
await fahre("eine echte Katalogdatei scheitert",
  (url) => { if (url.includes("beneos_items_database")) throw new Error("aus"); return { ok: true } }, true)

// Rueckfallprobe: alles gelingt. Musste online bleiben.
await fahre("alles gelingt", () => ({ ok: true }), true)

// Wert 2: Wiederholung. Bei totalem Ausfall muss jede Datei mehrfach versucht werden.
await fahre("nichts geht, mit Zwischenspeicher", () => { throw new Error("aus") }, true)

const spalte = (t, n) => String(t).padEnd(n)
console.log("  " + spalte("Fall", 38) + spalte("offline?", 10) + "Netzabrufe")
for (const f of faelle) {
  console.log("  " + spalte(f.name, 38) + spalte(f.offline ? "JA" : "nein", 10) + f.abrufe)
}

const [nurI18n, eineEchte, allesGut, nichtsGeht] = faelle
const proben = [
  ["Wert 1: nur Sprachmatrix scheitert -> NICHT offline", nurI18n.offline === false],
  ["Rueckfall: echte Katalogdatei scheitert -> offline", eineEchte.offline === true],
  ["Rueckfall: alles gelingt -> nicht offline", allesGut.offline === false],
  ["Rueckfall: alles gelingt -> genau 6 Abrufe", allesGut.abrufe === 6],
  ["Wert 2: erste Datei bekommt 3 Versuche", nichtsGeht.abrufe > allesGut.abrufe],
  ["Deckel: totaler Ausfall bleibt bei 8 statt 18 Abrufen", nichtsGeht.abrufe === 8],
  ["Zeitdeckel wird uebergeben", fetchProtokoll.every(a => a.timeoutMs === 15000)],
]

console.log("")
let schlecht = 0
for (const [name, ok] of proben) {
  console.log("  " + (ok ? "ja  " : "NEIN") + "  " + name)
  if (!ok) schlecht++
}
console.log("\n  " + (schlecht === 0 ? "alle Proben wie erwartet" : schlecht + " Probe(n) abweichend"))
process.exit(schlecht === 0 ? 0 : 1)
