// Prueft _deleteEmbeddedTolerant und _replaceEmbedded aus beneos_cloud.js
// gegen ein Attrappen-Dokument, das Foundrys Verhalten nachbildet.
//
// Der Kern: Foundrys Stapelloeschung ist ganz oder gar nicht. Fehlt EINE ID
// serverseitig, wirft ServerDatabaseBackend._deleteDocuments und loescht
// keine der anderen. Genau das hat beim Kunden die ganze Aktualisierung
// gestoppt.
//
// Aufruf:
//   node bench.mjs          fuehrt die Proben gegen den aktuellen Code
//   node bench.mjs --alt    fuehrt dieselben Proben gegen die Fassung VOR
//                           dem Fix, die dabei mit der woertlichen
//                           Kundenmeldung abbrechen MUSS
//
// Der zweite Aufruf ist der wichtigere. Ein gruener Test, der nie rot werden
// kann, belegt nichts.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, "..", "..", "scripts", "beneos_cloud.js")

/**
 * Schneidet die beiden Methoden aus der Quelldatei. Nach Klammern gezaehlt,
 * nicht nach Zeilennummern, damit der Prueffstand nicht bei der naechsten
 * Verschiebung im Modul stillschweigend das Falsche misst.
 */
function extractMethods(text, names) {
  const out = []
  for (const name of names) {
    const start = text.indexOf(`  async ${name}(`)
    if (start < 0) throw new Error(`Methode ${name} nicht in beneos_cloud.js gefunden`)
    let depth = 0
    let i = text.indexOf("{", start)
    const bodyStart = i
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++
      else if (text[i] === "}") {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) throw new Error(`Methode ${name} ist nicht geschlossen`)
    out.push(text.slice(start, i + 1))
    void bodyStart
  }
  return out
}

const ALT_IMPLEMENTATION = `
  async _deleteEmbeddedTolerant(doc, type, ids) {
    if (!ids?.length) return []
    await doc.deleteEmbeddedDocuments(type, ids)
    return []
  }
  async _replaceEmbedded(doc, type, dataList) {
    const collection = doc.getEmbeddedCollection(type)
    const oldIds = collection.map(d => d.id)
    if (oldIds.length) await doc.deleteEmbeddedDocuments(type, oldIds)
    if (dataList?.length) await doc.createEmbeddedDocuments(type, dataList, { keepId: true })
    return []
  }
`

const useAlt = process.argv.includes("--alt")
const body = useAlt
  ? ALT_IMPLEMENTATION
  : extractMethods(readFileSync(SOURCE, "utf8"), ["_deleteEmbeddedTolerant", "_replaceEmbedded"]).join("\n")

const Probe = new Function(`return class Probe {\n${body}\n}`)()

class FakeCollection extends Map {
  map(fn) { return Array.from(this.values()).map(fn) }
}

class FakeDoc {
  // vanished: IDs, die der Client noch listet, der Server aber nicht mehr hat.
  // undeletable: IDs, die dauerhaft nicht loeschbar sind.
  constructor(ids, vanished = [], undeletable = []) {
    this.coll = new FakeCollection()
    for (const id of ids) this.coll.set(id, { id, _id: id })
    this.vanished = new Set(vanished)
    this.undeletable = new Set(undeletable)
    this.deleteCalls = []
    this.created = []
  }
  getEmbeddedCollection() { return this.coll }
  async deleteEmbeddedDocuments(type, ids) {
    this.deleteCalls.push(ids.slice())
    for (const id of ids) {
      if (this.vanished.has(id)) {
        // Beim Fehlschlag merkt auch der Client, dass das Dokument weg ist.
        this.coll.delete(id)
        throw new Error(`${type} "${id}" does not exist!`)
      }
      if (this.undeletable.has(id)) throw new Error(`${type} "${id}" is locked`)
    }
    for (const id of ids) this.coll.delete(id)
    return ids
  }
  async createEmbeddedDocuments(type, data) {
    for (const d of data) {
      if (this.coll.has(d._id)) throw new Error(`${type} "${d._id}" already exists!`)
      this.coll.set(d._id, d)
    }
    this.created.push(...data.map(d => d._id))
    return data
  }
}

const p = new Probe()
let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? "OK  " : "FAIL"} ${name}` + (ok ? "" : `\n       erwartet ${JSON.stringify(want)}\n       gemessen ${JSON.stringify(got)}`))
}

// 1) Normalfall: nichts ist verschwunden, ein Stapel reicht.
{
  const doc = new FakeDoc(["a", "b", "c"])
  check("1 Normalfall, kein Rest", await p._deleteEmbeddedTolerant(doc, "ActiveEffect", ["a", "b", "c"]), [])
  check("1 Normalfall, genau ein Stapelaufruf", doc.deleteCalls.length, 1)
  check("1 Normalfall, Sammlung leer", doc.coll.size, 0)
}

// 2) Der gemeldete Fehler. Vorher riss diese eine ID den ganzen Aktor mit.
{
  const ids = ["x", "dnd5edeafened000", "y"]
  const doc = new FakeDoc(ids, ["dnd5edeafened000"])
  check("2 verschwundene ID, kein Rest", await p._deleteEmbeddedTolerant(doc, "ActiveEffect", ids), [])
  check("2 verschwundene ID, x und y sind trotzdem geloescht", doc.coll.size, 0)
  check("2 verschwundene ID, zwei Aufrufe", doc.deleteCalls.length, 2)
}

// 3) Eine ID, die sich nicht loeschen laesst und die der Client weiter listet.
{
  const ids = ["x", "stuck", "y"]
  const doc = new FakeDoc(ids, [], ["stuck"])
  check("3 hartnaeckige ID wird benannt", await p._deleteEmbeddedTolerant(doc, "ActiveEffect", ids), ["stuck"])
  check("3 hartnaeckige ID, x und y sind weg", Array.from(doc.coll.keys()), ["stuck"])
}

// 4) Leere Liste kostet keinen Aufruf.
{
  const doc = new FakeDoc([])
  check("4 leere Liste, kein Rest", await p._deleteEmbeddedTolerant(doc, "Item", []), [])
  check("4 leere Liste, kein Aufruf", doc.deleteCalls.length, 0)
}

// 5) Ersetzen im Normalfall.
{
  const doc = new FakeDoc(["alt1", "alt2"])
  check("5 Ersetzen, keine Befunde", await p._replaceEmbedded(doc, "ActiveEffect", [{ _id: "neu1" }, { _id: "neu2" }]), [])
  check("5 Ersetzen, neue angelegt", doc.created, ["neu1", "neu2"])
}

// 6) Die Kernprobe: eine verschwundene ID darf das Ersetzen nicht stoppen.
{
  const doc = new FakeDoc(["alt1", "dnd5eincapacitat"], ["dnd5eincapacitat"])
  check("6 verschwundene ID, keine Befunde", await p._replaceEmbedded(doc, "ActiveEffect", [{ _id: "neu1" }]), [])
  check("6 verschwundene ID, das Neue wurde trotzdem angelegt", doc.created, ["neu1"])
}

// 7) Bleibt eine ID stehen, die auch neu kommen soll, wird sie uebersprungen,
//    statt die ganze Anlage per keepId-Kollision scheitern zu lassen.
{
  const doc = new FakeDoc(["kollision"], [], ["kollision"])
  const probs = await p._replaceEmbedded(doc, "Item", [{ _id: "kollision" }, { _id: "neu1" }])
  check("7 Kollision, zwei Befunde", probs.length, 2)
  check("7 Kollision, neu1 wurde trotzdem angelegt", doc.created, ["neu1"])
}

console.log(fails ? `\n${fails} FEHLSCHLAEGE` : `\nalle Proben bestanden${useAlt ? " (das waere ein Befund, siehe README)" : ""}`)
process.exit(fails ? 1 : 0)
