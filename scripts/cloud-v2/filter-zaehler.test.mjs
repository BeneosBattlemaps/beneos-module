/**
 * filter-zaehler.test.mjs
 *
 * Gegenprobe zu MO-040, ohne Foundry:
 *
 *   node --test scripts/cloud-v2/filter-zaehler.test.mjs
 *
 * Im schmalen Cloud-Fenster liegen die Filter hinter dem Knopf "Filters (n)".
 * Die Zahl n kommt aus countActiveFilters, und dieselbe Funktion entscheidet
 * seit MO-040 auch, ob ein Filter aktiv ist (#hasActiveFilter, das die
 * Gruppierung "Update" der Ergebnisliste steuert). Diese Entscheidung darf
 * sich durch den Umbau nicht aendern.
 *
 * Das Orakel unten ist eine woertliche Kopie von #hasActiveFilter aus
 * 9c913a2 (cloud-window-v2.mjs:1255-1284). Ersetzt sind nur `this.` durch
 * den Zustand `s` und die DOM-Abfrage der Selects durch eine Wertetabelle.
 *
 * Gefahren wird dieselbe Zuordnung, die das Fenster nutzt (filterStateOf):
 * der Zustand `s` hat die Feldnamen des Fensters, die Selects kommen ueber
 * ein falsches Wurzelelement mit querySelector.
 *
 * Die Zahl auf dem Knopf (countShownFilters) zaehlt zusaetzlich verborgene
 * Quellen in Loot und Spells und den Show-Filter in Maps. Diese beiden
 * wirken dort auf die Liste, gehoeren aber nicht zur alten Entscheidung.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { countActiveFilters, countShownFilters, filterStateOf } from "./filter-count.mjs"
import { V2_FILTER_DEFS } from "./filter-defs.mjs"

const CR_NO_LIMIT = 31

// Die echten Filterdefinitionen der Dropdowns aus filter-defs.mjs, seit
// MO-043 importiert statt kopiert. Die Zaehlung liest nur types und selector.
const DEFS = V2_FILTER_DEFS

function orakel(type, s, selects) {
  if (s._textFilter) return true
  if (type === "token") {
    if (s.crMin > 0) return true
    if (s.crMax < CR_NO_LIMIT) return true
    if (s.sourceHidden.size > 0) return true
    if (s.biomeFilters.size > 0) return true
  }
  if (type === "item") {
    if (s.goldMin > 0) return true
    if (s.goldMax != null && s.goldMax < s.maxItemPrice) return true
  }
  if (type === "bmap") {
    if (s.bmapBiomeFilters.size > 0) return true
  }
  for (const def of DEFS) {
    if (def.types && !def.types.includes(type)) continue
    if (!(def.selector in selects)) continue
    const v = selects[def.selector]
    if (v && v.toLowerCase() !== "any") return true
  }
  return false
}

function ruhe() {
  return {
    _textFilter: "", crMin: 0, crMax: CR_NO_LIMIT, sourceHidden: new Set(),
    biomeFilters: new Set(), goldMin: 0, goldMax: null, maxItemPrice: 5000,
    bmapBiomeFilters: new Set(), showFilter: "any",
  }
}

// Ein Wurzelelement, das nur die Selects der Wertetabelle kennt.
function wurzel(selects) {
  return {
    querySelector(sel) {
      const id = sel.slice(1)
      return id in selects ? { value: selects[id] } : null
    },
  }
}

// Der Zustand, wie das Fenster ihn an die Zaehlung gibt (#filterState).
function zustand(s, selects, aufrufe = { preis: 0, quelle: 0 }, quelleImReiter = true) {
  return filterStateOf(s, {
    crNoLimit: CR_NO_LIMIT,
    maxItemPrice: () => { aufrufe.preis++; return s.maxItemPrice },
    hiddenSourceInTab: () => { aufrufe.quelle++; return quelleImReiter },
    root: wurzel(selects),
    defs: DEFS,
  })
}

function zaehle(type, s, selects, aufrufe) {
  return countActiveFilters(type, zustand(s, selects, aufrufe))
}

const alleSelects = Object.fromEntries(DEFS.map(d => [d.selector, "any"]))

// Je Fall: Reiter, Aenderung am Ruhezustand, Selects, erwartete Zahl.
const faelle = [
  ["token", s => s, alleSelects, 0],
  ["token", s => { s._textFilter = "goblin" }, alleSelects, 1],
  ["token", s => { s._textFilter = " " }, alleSelects, 1],          // ungetrimmt wie bisher
  ["token", s => { s.crMin = 2 }, alleSelects, 1],
  ["token", s => { s.crMin = 2; s.crMax = 10 }, alleSelects, 1],   // ein Bereich zaehlt einmal
  ["token", s => { s.sourceHidden.add("a"); s.sourceHidden.add("b") }, alleSelects, 1],
  ["token", s => { s.biomeFilters.add("forest"); s.biomeFilters.add("cave") }, alleSelects, 2],
  ["token", s => s, { ...alleSelects, "faction-selector": "undead" }, 1],
  ["token", s => s, { ...alleSelects, "faction-selector": "ANY" }, 0],
  ["token", s => s, { ...alleSelects, "faction-selector": "" }, 0],
  ["token", s => s, { "campaign-selector": "x" }, 1],                // fehlende Selects uebersprungen
  ["token", s => s, { ...alleSelects, "rarity-selector": "rare" }, 0], // fremder Reiter zaehlt nicht
  ["token", s => { s.goldMin = 10; s.bmapBiomeFilters.add("x") }, alleSelects, 0],
  ["item", s => { s.goldMin = 10 }, alleSelects, 1],
  ["item", s => { s.goldMax = 100 }, alleSelects, 1],
  ["item", s => { s.goldMax = 5000 }, alleSelects, 0],
  ["item", s => { s.goldMax = null }, alleSelects, 0],
  ["item", s => { s.goldMin = 10; s.goldMax = 100 }, alleSelects, 1],
  ["item", s => { s.crMin = 5 }, { ...alleSelects, "rarity-selector": "rare", "installation-selector": "installed" }, 2],
  ["bmap", s => { s.bmapBiomeFilters.add("a"); s.bmapBiomeFilters.add("b") }, { ...alleSelects, "bmap-brightness": "dark" }, 3],
  ["bmap", s => s, { ...alleSelects, "installation-selector": "installed" }, 0],
  ["spell", s => { s._textFilter = "fire" }, { ...alleSelects, "level-selector": "3" }, 2],
]

for (const [type, aendern, selects, erwartet] of faelle) {
  test(`${type}: ${aendern.toString().slice(5, 70)} ${JSON.stringify(selects).slice(0, 40)}`, () => {
    const s = ruhe(); aendern(s)
    const n = zaehle(type, s, selects)
    assert.equal(n, erwartet)
    assert.equal(n > 0, orakel(type, s, selects), "Zahl > 0 muss der alten Entscheidung gleichen")
  })
}

test("Zwei-Werte-Probe: ein aktiver Filter aendert die Zahl, ein Filter eines anderen Reiters nicht", () => {
  const s = ruhe()
  const basis = zaehle("token", s, alleSelects)
  assert.equal(zaehle("token", s, { ...alleSelects, "faction-selector": "undead" }), basis + 1)
  assert.equal(zaehle("token", s, { ...alleSelects, "level-selector": "3" }), basis)
})

test("Hoechstpreis wird nur im Reiter item abgefragt", () => {
  const s = ruhe(); s.goldMax = 100
  for (const type of ["token", "bmap", "spell"]) {
    const aufrufe = { preis: 0, quelle: 0 }
    zaehle(type, s, alleSelects, aufrufe)
    assert.equal(aufrufe.preis, 0, type)
  }
  const aufrufe = { preis: 0, quelle: 0 }
  zaehle("item", s, alleSelects, aufrufe)
  assert.equal(aufrufe.preis, 1)
})

test("ohne Wurzelelement zaehlen die Selects nicht", () => {
  const s = ruhe(); s._textFilter = "x"
  const z = filterStateOf(s, { crNoLimit: CR_NO_LIMIT, maxItemPrice: () => 0, hiddenSourceInTab: () => false, root: null, defs: DEFS })
  assert.deepEqual(z.dropdowns, [])
  assert.equal(countActiveFilters("token", z), 1)
})

// Knopfzahl: je Fall Reiter, Aenderung, ob die verborgene Quelle im Reiter
// Eintraege hat, erwartete Knopfzahl und erwartete alte Zahl.
const knopf = [
  ["item",  s => { s.sourceHidden.add("srd") }, true,  1, 0],
  ["item",  s => { s.sourceHidden.add("srd") }, false, 0, 0],   // Quelle ohne Eintrag hier
  ["spell", s => { s.sourceHidden.add("srd") }, true,  1, 0],
  ["token", s => { s.sourceHidden.add("srd") }, true,  1, 1],   // Token zaehlt schon im alten Teil
  ["bmap",  s => { s.showFilter = "installed" }, true, 1, 0],
  ["bmap",  s => { s.showFilter = "Any" }, true, 0, 0],
  ["token", s => { s.showFilter = "installed" }, true, 0, 0],    // Token liest den Select, nicht die Instanz
  ["item",  s => { s.sourceHidden.add("srd"); s.goldMin = 5 }, true, 2, 1],
]

for (const [type, aendern, imReiter, erwartet, alt] of knopf) {
  test(`Knopf ${type}: ${aendern.toString().slice(5, 60)} imReiter=${imReiter}`, () => {
    const s = ruhe(); aendern(s)
    const z = zustand(s, alleSelects, undefined, imReiter)
    assert.equal(countShownFilters(type, z), erwartet)
    assert.equal(countActiveFilters(type, z), alt, "alte Zahl bleibt")
  })
}

test("Quellen des Reiters werden nur gesucht, wenn eine Quelle verborgen ist", () => {
  const aufrufe = { preis: 0, quelle: 0 }
  countShownFilters("item", zustand(ruhe(), alleSelects, aufrufe))
  assert.equal(aufrufe.quelle, 0)
})
