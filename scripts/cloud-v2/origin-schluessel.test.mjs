/**
 * origin-schluessel.test.mjs
 *
 * Gegenprobe zu MO-043, ohne Foundry (Attrappen fuer die Globals):
 *
 *   node --test scripts/cloud-v2/origin-schluessel.test.mjs
 *
 * Der Item-Katalog fuehrt die Herkunft in zwei Schreibweisen, etwa
 * `techno_arcane` neben `technoarcane`. Das Cloud-Fenster zeigte dadurch zwei
 * Filteroptionen, und jede fand nur ihren Teil der Items. Seit MO-043 wird die
 * Herkunft beim Einlesen des Katalogs auf die kanonische Form gebracht, die
 * auch Registry, Hover-Texte und Uebersetzungsmatrix fuehren.
 *
 * Gefahren wird das ECHTE buildSearchData() und das echte searchByProperty().
 * Je ein Wert, dessen Ergebnis sich aendern muss (techno_arcane), und einer,
 * dessen Ergebnis gleich bleiben muss (dwarvenforged).
 *
 * Alle Daten stehen als Literale hier, denn der pre-commit-Haken spielt nur
 * scripts, tools, lang und module.json aus, nicht data/.
 */
import { test } from "node:test"
import assert from "node:assert/strict"

// ------------------------------------------------------------ Attrappen ----
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true })
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } }
const knoten = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
  appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {},
  querySelector: () => null, querySelectorAll: () => [], textContent: "", innerHTML: "",
})
globalThis.document = {
  createElement: knoten, createTextNode: knoten, head: knoten(), body: knoten(),
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
}
globalThis.window = globalThis
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
class Leer { constructor() {} static get defaultOptions() { return {} } }
for (const name of ["FormApplication", "Application", "Dialog", "FilePicker", "Actor", "Item", "Scene", "Token"]) {
  if (globalThis[name] === undefined) globalThis[name] = Leer
}
globalThis.Hooks = { on() {}, once() {}, callAll() {}, call() {} }
globalThis.CONFIG = {}
globalThis.foundry = {
  applications: { api: { ApplicationV2: Leer, HandlebarsApplicationMixin: (B) => B }, instances: {} },
  utils: { mergeObject: (a, b) => Object.assign(a, b) },
}
globalThis.game = {
  i18n: { localize: (k) => k, format: (k) => k, lang: "en" },
  settings: { get: () => ({}), set() {} },
  beneosTokens: {},
  beneos: {
    cloud: {
      isItemAvailable: () => false, isFreeAsset: () => false, isLoggedIn: () => false,
      getItemHash: () => null, getPatreonStatus: () => null,
    },
  },
}

// Die Pfade stehen als new URL(...), damit die Attrappen vor dem Laden stehen
// und der Importgraph des Hakens (tools/haken/betroffen.mjs) sie trotzdem liest.
const { herkunftSchluessel, herkunftIconUrl, herkunftFarbe } = await import(new URL("./origin-schluessel.mjs", import.meta.url))
const { BeneosDatabaseHolder } = await import(new URL("../beneos_search_engine.js", import.meta.url))
const { BeneosUtility } = await import(new URL("../beneos_utility.js", import.meta.url))
const { V2_FILTER_DEFS } = await import(new URL("./filter-defs.mjs", import.meta.url))
const { OriginsRegistry } = await import(new URL("../loot/origins-registry.mjs", import.meta.url))
BeneosUtility.isItemLoaded = () => false
BeneosUtility.getItemInstallTS = () => 0
BeneosUtility.getItemInstallHash = () => null

function item(name, origin) {
  return { name, description: "", properties: { origin, rarity: "Rare", item_type: "Wondrous Item", tier: 1, price: "100", icon: name + "-icon.webp" } }
}

function baueKatalog(content) {
  BeneosDatabaseHolder.tokenData = { content: {} }
  BeneosDatabaseHolder.bmapData = { content: {} }
  BeneosDatabaseHolder.spellData = { content: {} }
  BeneosDatabaseHolder.itemData = { content }
  BeneosDatabaseHolder.buildSearchData()
  return BeneosDatabaseHolder.itemData.content
}

const herkunftOptionen = () =>
  BeneosDatabaseHolder.getData().origin.map((o) => o.key).filter((k) => k !== "any").sort()

// -------------------------------------------------------------- Proben ----

test("Wert mit Aenderung: beide Schreibweisen ergeben je EINE Filteroption", () => {
  baueKatalog({
    "0105_a": item("A", "techno_arcane"),
    "0033_b": item("B", "technoarcane"),
    "0166_c": item("C", "giant_forged"),
    "0020_d": item("D", "giantforged"),
    "0001_e": item("E", "dwarvenforged"),
  })
  assert.deepEqual(herkunftOptionen(), ["dwarvenforged", "giantforged", "technoarcane"])
})

test("Filter: Technoarcane findet beide Schreibweisen, Arcane keine davon", () => {
  const content = baueKatalog({
    "0105_a": item("A", "techno_arcane"),
    "0033_b": item("B", "technoarcane"),
    "0002_f": item("F", "arcane"),
  })
  // Die ECHTE Definition des Fensters, nicht eine Kopie: so wird auch ein
  // spaeter entferntes strict rot (das Fenster ruft searchByProperty genauso).
  const def = V2_FILTER_DEFS.find((d) => d.selector === "origin-selector")
  assert.equal(def.prop, "origin")
  const treffer = (wert) =>
    Object.values(BeneosDatabaseHolder.searchByProperty("item", def.prop, wert, content, def.strict === true)).map((i) => i.name).sort()
  assert.deepEqual(treffer("technoarcane"), ["A", "B"])
  assert.deepEqual(treffer("arcane"), ["F"])
})

test("Wert ohne Aenderung: dwarvenforged bleibt dwarvenforged, im Katalog wie als Funktion", () => {
  const content = baueKatalog({ "0001_e": item("E", "dwarvenforged") })
  assert.equal(content["0001_e"].properties.origin, "dwarvenforged")
  assert.equal(herkunftSchluessel("dwarvenforged"), "dwarvenforged")
  assert.equal(herkunftSchluessel("Arcane"), "arcane")
})

test("Funktion: Trennzeichen fallen in jedem Wert, Alias crystaline, leer bleibt leer, idempotent", () => {
  assert.equal(herkunftSchluessel("techno_arcane"), "technoarcane")
  assert.equal(herkunftSchluessel("Giant Forged"), "giantforged")
  assert.equal(herkunftSchluessel("dwarven_forged"), "dwarvenforged")
  assert.equal(herkunftSchluessel("Sea-Born"), "seaborn")
  assert.equal(herkunftSchluessel("crystaline"), "crystalline")
  assert.equal(herkunftSchluessel(""), "")
  assert.equal(herkunftSchluessel(null), "")
  assert.equal(herkunftSchluessel(herkunftSchluessel("techno_arcane")), "technoarcane")
})

// Die 22 origin-Werte des Livekatalogs, gemessen am 2026-11-24 (744 Items),
// und die 19 Slugs aus data/_itemorigins/origins.json.
const KATALOG_WERTE = [
  "ancient", "arcane", "awoken", "beastforged", "blessed", "crystalline", "druidic",
  "dwarvenforged", "elemental", "feywoven", "giant_forged", "giantforged", "infernal",
  "mutation", "occult", "primordial", "relic", "sanctified", "srd", "techno_arcane",
  "technoarcane", "vampiric",
]
const REGISTRY_SLUGS = [
  "awoken", "elemental", "vampiric", "druidic", "arcane", "dwarvenforged", "sanctified",
  "infernal", "blessed", "primordial", "relic", "mutation", "ancient", "technoarcane",
  "crystalline", "beastforged", "feywoven", "occult", "giantforged",
]

test("Icon: farbige Scheibe aus dem Modul ueber die Registry, srd ohne Icon (MO-044)", () => {
  // Zwei Eintraege wie in data/_itemorigins/origins.json, als Literale.
  OriginsRegistry.origins = {
    beastforged: { slug: "beastforged", icon_filename: "beastforged.webp", icon_filename_bw: "beastforged_blackwhite.webp" },
    technoarcane: { slug: "technoarcane", icon_filename: "techno_arcane.webp", icon_filename_bw: "techno_arcane_blackwhite.webp" },
  }
  const modul = (datei) => `modules/beneos-module/icons/origin/${datei}`
  // Wert mit Aenderung: beastforged fehlt am CDN, die Scheibe liegt im Modul.
  assert.equal(herkunftIconUrl("beastforged"), modul("beastforged.webp"))
  // Der Dateiname kommt aus der Registry, nicht aus einer eigenen Namensregel.
  assert.equal(herkunftIconUrl("technoarcane"), modul("techno_arcane.webp"))
  // Wert ohne sichtbare Aenderung: srd ist eine Quelle, keine Herkunft, und zeigt kein Icon.
  assert.equal(herkunftIconUrl("srd"), null)
  assert.equal(herkunftIconUrl(""), null)
})

test("Icon ohne geladene Registry: Ersatz aus ORIGIN_META, srd bleibt ohne Icon (MO-044 Nachtrag)", () => {
  // Zustand nach einem gescheiterten load() (origins-registry.mjs: origins = {}, loaded = false),
  // der bis zum Neuladen der Welt nicht heilt. Ohne Ersatz fehlte das Emblem bei allen 19 Herkuenften.
  const vorher = { origins: OriginsRegistry.origins, loaded: OriginsRegistry.loaded }
  OriginsRegistry.origins = {}
  OriginsRegistry.loaded = false
  try {
    // Wert mit Aenderung: Pfad und Farbe sind da, die Vorlage zeigt das Emblem.
    assert.equal(herkunftIconUrl("beastforged"), "modules/beneos-module/icons/origin/beastforged.webp")
    assert.equal(herkunftFarbe("beastforged"), "#a86838")
    // Wert ohne Aenderung: srd steht weder in der Registry noch in ORIGIN_META.
    assert.equal(herkunftIconUrl("srd"), null)
    assert.equal(herkunftIconUrl(""), null)
  } finally {
    OriginsRegistry.origins = vorher.origins
    OriginsRegistry.loaded = vorher.loaded
  }
})

test("Icon-Farbe: dieselbe Glow-Farbe wie in der Codex-Galerie, srd ohne Farbe (MO-044)", () => {
  // Der Codex faerbt die Scheibe je Herkunft ein; ohne Farbe saehe jede Herkunft gleich rot aus.
  assert.equal(herkunftFarbe("beastforged"), "#a86838")
  assert.equal(herkunftFarbe("technoarcane"), "#4ac8d9")
  assert.equal(herkunftFarbe("srd"), null)
  assert.equal(herkunftFarbe(""), null)
})

test("Livekatalog: 22 Rohwerte werden zu 20, genau die Registry plus srd", () => {
  const kanonisch = [...new Set(KATALOG_WERTE.map(herkunftSchluessel))].sort()
  assert.equal(kanonisch.length, 20)
  assert.deepEqual(kanonisch, [...REGISTRY_SLUGS, "srd"].sort())
})
