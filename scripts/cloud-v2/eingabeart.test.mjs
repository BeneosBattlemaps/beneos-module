/**
 * eingabeart.test.mjs
 *
 * Gegenprobe zu MO-042, ohne Foundry:
 *
 *   node --test scripts/cloud-v2/eingabeart.test.mjs
 *
 * Die Filter-Selects des Cloud-Fensters zeigen den Fokusring nur, wenn
 * data-bc-input="key" am Fenster steht. Geprueft wird, welche Eingabe das
 * Attribut auf welchen Wert setzt, und dass ein Neuzeichnen keine weiteren
 * Listener anhaengt.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { inputKindOf, markInputKind, wireInputKind, wireWindowInputKind } from "./eingabeart.mjs"

// Ein Ziel mit addEventListener, das die Listener zaehlt und Ereignisse
// an die Capture-Listener ausliefert.
function falschesZiel() {
  const listener = []
  return {
    listener,
    addEventListener(type, fn, capture) { listener.push({ type, fn, capture }) },
    feuere(ev) { for (const l of listener) if (l.type === ev.type) l.fn(ev) },
  }
}

test("Tastendruck ohne Modifikator ist Tastatur, Zeigerdruck ist Zeiger", () => {
  assert.equal(inputKindOf({ type: "keydown", key: "Tab" }), "key")
  assert.equal(inputKindOf({ type: "keydown", key: "ArrowDown" }), "key")
  assert.equal(inputKindOf({ type: "keydown", key: "Tab", shiftKey: true }), "key")
  assert.equal(inputKindOf({ type: "pointerdown", pointerType: "mouse" }), "pointer")
  assert.equal(inputKindOf({ type: "pointerdown", pointerType: "touch" }), "pointer")
  assert.equal(inputKindOf({ type: "pointerdown", pointerType: "pen" }), "pointer")
})

test("Tastenkuerzel und fremde Ereignisse aendern nichts", () => {
  assert.equal(inputKindOf({ type: "keydown", key: "f", ctrlKey: true }), null)
  assert.equal(inputKindOf({ type: "keydown", key: "Tab", altKey: true }), null)
  assert.equal(inputKindOf({ type: "keydown", key: "c", metaKey: true }), null)
  assert.equal(inputKindOf({ type: "focusin" }), null)
  assert.equal(inputKindOf({ type: "keyup", key: "Tab" }), null)
})

test("einmal je Ziel verdrahtet, in der Capture-Phase", () => {
  const ziel = falschesZiel()
  const a = wireInputKind(ziel, () => {})
  const b = wireInputKind(ziel, () => {})
  assert.equal(a, b)
  assert.equal(ziel.listener.length, 2)
  assert.deepEqual(ziel.listener.map((l) => [l.type, l.capture]), [["keydown", true], ["pointerdown", true]])
})

test("apply laeuft nur beim Wechsel der Eingabeart", () => {
  const ziel = falschesZiel()
  const gesehen = []
  const zustand = wireInputKind(ziel, (k) => gesehen.push(k))
  assert.equal(zustand.kind, null)
  ziel.feuere({ type: "keydown", key: "Tab" })
  ziel.feuere({ type: "keydown", key: "Tab" })
  ziel.feuere({ type: "keydown", key: "f", ctrlKey: true })
  ziel.feuere({ type: "pointerdown", pointerType: "mouse" })
  ziel.feuere({ type: "pointerdown", pointerType: "mouse" })
  ziel.feuere({ type: "keydown", key: "ArrowDown" })
  assert.deepEqual(gesehen, ["key", "pointer", "key"])
  assert.equal(zustand.kind, "key")
})

// Ein echtes Neuoeffnen baut ein NEUES Element ohne Attribute (Kalt-Review
// MO-042). Die Attrappe liefert darum je Oeffnen ein frisches Element.
function element() {
  const attribute = new Map()
  return { attribute, setAttribute: (n, v) => attribute.set(n, v) }
}

test("das Fenster bekommt data-bc-input bei jedem Wechsel", () => {
  const ziel = falschesZiel()
  const fenster = element()
  const doc = { getElementById: (id) => (id === "beneos-cloud-window-v2" ? fenster : null) }
  wireWindowInputKind(ziel, doc, "beneos-cloud-window-v2")
  ziel.feuere({ type: "keydown", key: "Tab" })
  assert.equal(fenster.attribute.get("data-bc-input"), "key")
  ziel.feuere({ type: "pointerdown", pointerType: "mouse" })
  assert.equal(fenster.attribute.get("data-bc-input"), "pointer")
})

test("ein neu geoeffnetes Fenster traegt die Art ohne neue Eingabe", () => {
  const ziel = falschesZiel()
  let fenster = element()
  const doc = { getElementById: (id) => (fenster && id === "beneos-cloud-window-v2" ? fenster : null) }
  const zustand = wireWindowInputKind(ziel, doc, "beneos-cloud-window-v2")
  ziel.feuere({ type: "keydown", key: "Tab" })
  // Schliessen: kein Element, die Eingabeart bleibt gemerkt.
  fenster = null
  ziel.feuere({ type: "keydown", key: "ArrowDown" })
  // Neuoeffnen: frisches Element, gleiche Art, kein Wechsel, also kein apply.
  fenster = element()
  ziel.feuere({ type: "keydown", key: "Tab" })
  assert.equal(fenster.attribute.get("data-bc-input"), undefined)
  // Das Zeichnen (_onRender) traegt die Art hinueber.
  markInputKind(fenster, zustand)
  assert.equal(fenster.attribute.get("data-bc-input"), "key")
})

test("vor der ersten Eingabe setzt das Zeichnen nichts", () => {
  const fenster = element()
  markInputKind(fenster, { kind: null })
  markInputKind(null, { kind: "key" })
  assert.equal(fenster.attribute.size, 0)
})
