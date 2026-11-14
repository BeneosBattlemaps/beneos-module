#!/usr/bin/env node
/**
 * Zaehlt Toradressen MIT Streamschluessel in einem Weltexport, je Dokumenttyp
 * und Feld. stre-T-065, Nachweis zu OP-PRJ-149.
 *
 * WOZU. OP-PRJ-149 verlangt den Beleg, dass nach einer Installation im
 * Streambetrieb der Schluessel nur in Szenendokumenten steht und nirgends in
 * einem `img`-Feld oder einer Journalseite. Dieses Werkzeug liefert die Zahl
 * dazu, ohne den Schluessel je zu zeigen.
 *
 * ES GIBT NIE EINEN WERT AUS. Nicht ganz, nicht gekuerzt, nicht im Fehlerfall.
 * Ausgegeben werden nur Dokumenttyp, Feldpfad und Zahlen. Eine Fehlermeldung
 * nennt die Datei, nie den Text des Parsers, denn der zitiert den Inhalt.
 * Zusaetzlich wird jede Ausgabezeile gegen alle gefundenen Schluesselstuecke
 * geprueft, bevor sie geschrieben wird.
 *
 * NUR LESEND, OHNE NETZ. Es oeffnet Dateien nur zum Lesen und baut keine
 * Verbindung auf.
 *
 * EINGABE. Ein Ordner mit dem Export einer Welt: JSON-Dateien je Dokument
 * (`fvtt package unpack`, mit `_key` wie `!actors!<id>`), NDJSON-Dateien
 * (`*.db`, eine Zeile je Dokument) oder einzelne JSON-Dateien. Ein LevelDB-
 * Ordner (`CURRENT` plus `MANIFEST-*`) wird NICHT gelesen: seine Bloecke sind
 * komprimiert, eine Textsuche darin zaehlte zu wenig und sagte trotzdem
 * "null". Er wird gemeldet, und der Lauf endet mit 2.
 *
 * Aufruf:
 *   node tools/schluessel-suche/suche.mjs <ordner-oder-datei> [--basis <url>]
 *
 * Vorgabe fuer --basis ist https://gate.beneos.stream (DEFAULT_BASE in
 * scripts/stream/stream-settings.mjs).
 *
 * Rueckgabe: 0 gelesen, 2 mindestens eine Datei unlesbar oder LevelDB, 1
 * Aufruffehler.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, relative, basename, extname } from "node:path"

// Dieselben Raumbuchstaben wie STREAM_RAUM_BUCHSTABE in stream-settings.mjs.
const RAEUME = ["a", "c", "l", "s"]

function aufruf(argv) {
  const args = argv.slice(2)
  let pfad = null
  let basis = "https://gate.beneos.stream"
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--basis") { basis = String(args[++i] || ""); continue }
    if (pfad === null) pfad = args[i]
  }
  return { pfad, basis: basis.replace(/\/+$/, "") }
}

function musterFuer(basis) {
  const roh = basis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Das zweite Stueck ist der Schluessel. "-" ist die maskierte Form und zaehlt nicht.
  return new RegExp(`${roh}/(?:${RAEUME.join("|")})/([^/\\s"'<>\\\\]+)/`, "g")
}

const { pfad, basis } = aufruf(process.argv)
if (!pfad || !basis) {
  process.stderr.write("Aufruf: node suche.mjs <ordner-oder-datei> [--basis <url>]\n")
  process.exit(1)
}
if (!existsSync(pfad)) {
  process.stderr.write("Pfad fehlt: " + pfad + "\n")
  process.exit(1)
}

const MUSTER = musterFuer(basis)
const geheim = new Set()            // gefundene Schluesselstuecke, nur im Speicher
const zaehler = new Map()           // "typ\tfeld" -> {treffer, platzhalter}
const unlesbar = []
const leveldb = []
let dateien = 0
let dokumente = 0

function zaehle(typ, feld, art, n) {
  const k = typ + "\t" + feld
  const z = zaehler.get(k) || { treffer: 0, platzhalter: 0 }
  z[art] += n
  zaehler.set(k, z)
}

function feldName(teil) {
  // Ein Schluessel eines Objekts, der nicht wie ein Feldname aussieht, wird
  // nicht ausgegeben. Er koennte Inhalt tragen.
  return /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/.test(teil) ? teil : "<feld>"
}

function pruefeText(typ, feld, s) {
  MUSTER.lastIndex = 0
  let m
  let n = 0
  while ((m = MUSTER.exec(s)) !== null) {
    if (m[1] === "-") continue
    geheim.add(m[1])
    n++
  }
  if (n) zaehle(typ, feld, "treffer", n)
  const p = s.split("beneos://").length - 1
  if (p) zaehle(typ, feld, "platzhalter", p)
}

function gehe(typ, wert, pfadTeile) {
  if (typeof wert === "string") {
    pruefeText(typ, pfadTeile.join(".") || "<wurzel>", wert)
  } else if (Array.isArray(wert)) {
    for (const w of wert) gehe(typ, w, pfadTeile.length ? [...pfadTeile.slice(0, -1), pfadTeile[pfadTeile.length - 1] + "[]"] : ["[]"])
  } else if (wert && typeof wert === "object") {
    for (const [k, v] of Object.entries(wert)) {
      if (k === "_key") continue
      gehe(typ, v, [...pfadTeile, feldName(k)])
    }
  }
}

function typAus(dok, rueckfall) {
  const k = dok && typeof dok._key === "string" ? dok._key : ""
  const m = /^!([A-Za-z.]+)!/.exec(k)
  return m ? m[1] : rueckfall
}

function leseDatei(voll, rel, typRueckfall) {
  dateien++
  let text
  try { text = readFileSync(voll, "utf8") } catch (_) { unlesbar.push(rel); return }
  const endung = extname(voll).toLowerCase()
  if (endung === ".db") {
    let zeile = 0
    for (const z of text.split(/\r?\n/)) {
      zeile++
      if (!z.trim()) continue
      let dok
      try { dok = JSON.parse(z) } catch (_) { unlesbar.push(rel + " Zeile " + zeile); continue }
      dokumente++
      gehe(typAus(dok, basename(voll, ".db")), dok, [])
    }
    return
  }
  let dok
  try { dok = JSON.parse(text) } catch (_) { unlesbar.push(rel); return }
  const liste = Array.isArray(dok) ? dok : [dok]
  for (const d of liste) { dokumente++; gehe(typAus(d, typRueckfall), d, []) }
}

function istLevelDb(ordner) {
  try {
    const e = readdirSync(ordner)
    return e.includes("CURRENT") && e.some((n) => n.startsWith("MANIFEST-"))
  } catch (_) { return false }
}

function wandere(ordner, wurzel) {
  if (istLevelDb(ordner)) { leveldb.push(relative(wurzel, ordner) || "."); return }
  for (const name of readdirSync(ordner).sort()) {
    const voll = join(ordner, name)
    let st
    try { st = statSync(voll) } catch (_) { unlesbar.push(relative(wurzel, voll)); continue }
    if (st.isDirectory()) { wandere(voll, wurzel); continue }
    const e = extname(name).toLowerCase()
    if (e !== ".json" && e !== ".db") continue
    const rel = relative(wurzel, voll)
    const erstes = rel.split(/[\\/]/)[0]
    leseDatei(voll, rel, rel.includes("/") || rel.includes("\\") ? erstes : basename(name, e))
  }
}

const st = statSync(pfad)
if (st.isDirectory()) wandere(pfad, pfad)
else leseDatei(pfad, basename(pfad), basename(pfad, extname(pfad)))

// ─── Ausgabe, jede Zeile gegen die gefundenen Stuecke geprueft ────────────────

function sicher(zeile) {
  for (const g of geheim) if (g && zeile.includes(g)) return "<zeile maskiert>"
  return zeile
}
function aus(zeile) { process.stdout.write(sicher(zeile) + "\n") }

let summeT = 0
let summeP = 0
aus("typ\tfeld\ttreffer\tplatzhalter")
for (const k of [...zaehler.keys()].sort()) {
  const z = zaehler.get(k)
  summeT += z.treffer
  summeP += z.platzhalter
  aus(`${k}\t${z.treffer}\t${z.platzhalter}`)
}
for (const u of unlesbar) aus("UNLESBAR\t" + u)
for (const l of leveldb) aus("LEVELDB\t" + l + "\tnicht gelesen, erst exportieren (fvtt package unpack)")
aus(`SUMME treffer=${summeT} platzhalter=${summeP} dateien=${dateien} dokumente=${dokumente} unlesbar=${unlesbar.length} leveldb=${leveldb.length}`)
process.exit(unlesbar.length || leveldb.length ? 2 : 0)
