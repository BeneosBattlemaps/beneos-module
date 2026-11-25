/*
 * kompendium-riegel-bench
 *
 * Haelt fest, dass alle Wege, die die vier Welt-Kompendien entsperren, ueber
 * denselben Riegel laufen (stre-T-233). Laeuft ohne Foundry und ohne Netz:
 *
 *   node tools/kompendium-riegel-bench/bench.mjs
 *
 * Rueckgabewert 0 heisst alle Saetze gruen, 1 heisst mindestens einer rot.
 *
 * WARUM ER ENTSTANDEN IST. Zwei Sperrzyklen liefen ohne gemeinsamen Riegel auf
 * denselben Kompendien: die Pruefung beim Start
 * (`BeneosUtility.verifySettingsAgainstCompendium`) und die Installation. In
 * vier Laeufen von work-stre-3 belegt: verify brach mit "does not exist" in
 * `Actor.deleteDocuments` ab, items und spells blieben entsperrt, die
 * Registry war halb bereinigt, oder die Installation scheiterte an "locked
 * compendium world.beneos_module_journal".
 *
 * WAS AM VERHALTEN GEMESSEN WIRD UND WAS NUR AM QUELLTEXT. Lage A faehrt das
 * echte Modul `scripts/kompendium-riegel.mjs` gegen Attrappen der Kompendien:
 * ein gesperrtes Kompendium wirft beim Schreiben, eine fehlende Id wirft
 * "does not exist". Die Installationswege sind in Lage A nachgebaut, und zwar
 * so, wie `beneos_cloud.js` den Riegel benutzt. Dass `beneos_cloud.js` und
 * `beneos_utility.js` ihn wirklich so benutzen, misst Lage B am Quelltext,
 * denn ein Lauf ohne Foundry erreicht diese Dateien nicht.
 */

import { readFileSync, readdirSync } from "node:fs"
import { setImmediate } from "node:timers"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, "..", "..")
const CLOUD = join(WURZEL, "scripts", "beneos_cloud.js")
const UTILITY = join(WURZEL, "scripts", "beneos_utility.js")
const RIEGEL = join(WURZEL, "scripts", "kompendium-riegel.mjs")

let rot = 0
let gruen = 0

function pruefe(name, bedingung, auskunft) {
  if (bedingung) {
    gruen++
    console.log(`  ok   ${name}`)
  } else {
    rot++
    console.log(`  ROT  ${name}`)
  }
  if (auskunft) console.log(`       ${auskunft}`)
}

// Die Absturzwache nach bildform-adresse (stre-T-162): ein Wurf wird zur
// roten Zeile der zuletzt gestarteten Probe.
let laeuft = "Aufbau vor A1"
function beginne(name) {
  laeuft = name
}
function absturz(fehler) {
  rot++
  console.log(`  ROT  ${laeuft} Absturz: ${String(fehler?.message ?? fehler).slice(0, 200)}`)
  console.log("")
  console.log(`Ergebnis: ${gruen} gehalten, ${rot} Befund(e), abgebrochen.`)
  process.exit(1)
}
process.on("uncaughtException", absturz)
process.on("unhandledRejection", absturz)

const { inDerKette, entsperre, sperre, verwirfImRiegel, sperreNach, wartetAufNutzer, einmalJe } =
  await import(pathToFileURL(RIEGEL).href)

// ═══════════════════════════════════════════════════════════ Attrappen ═════

const takt = () => new Promise((r) => setImmediate(r))
async function takte(n) {
  for (let i = 0; i < n; i++) await takt()
}

class Pack {
  constructor(id) {
    this.collection = id
    this.locked = true
    this.docs = new Set()
    this.spur = []
  }
  async configure({ locked }) {
    await takt()
    this.locked = locked
    this.spur.push(locked ? "zu" : "auf")
  }
  async lege(id) {
    await takt()
    if (this.locked) throw new Error(`You may not modify the locked compendium ${this.collection}`)
    this.docs.add(id)
  }
  async loesche(id) {
    await takte(3)
    if (this.locked) throw new Error(`You may not modify the locked compendium ${this.collection}`)
    if (!this.docs.has(id)) throw new Error(`The document "${id}" does not exist in ${this.collection}`)
    this.docs.delete(id)
  }
}

let ACTOR, JOURNAL, ITEM, SPELL, ALLE, REG, fehler, zaehler
function frisch() {
  ACTOR = new Pack("world.beneos_module_actors")
  JOURNAL = new Pack("world.beneos_module_journal")
  ITEM = new Pack("world.beneos_module_items")
  SPELL = new Pack("world.beneos_module_spells")
  ALLE = [ACTOR, JOURNAL, ITEM, SPELL]
  REG = { tokens: {}, items: {}, spells: {} }
  fehler = []
  zaehler = 0
}
const neueId = (p) => `${p}${++zaehler}`
const alleZu = () => ALLE.every((p) => p.locked)
const offenListe = () => ALLE.filter((p) => !p.locked).map((p) => p.collection).join(", ") || "keins"

// Eine vorhandene Kreatur, ein vorhandenes Item, ein vorhandener Spell.
async function bestand() {
  for (const p of ALLE) p.locked = false
  ACTOR.docs.add("a-alt"); JOURNAL.docs.add("j-alt"); ITEM.docs.add("i-alt"); SPELL.docs.add("s-alt")
  REG.tokens.kreatur = { actorId: "a-alt", stand: 1 }
  REG.items.schwert = { itemId: "i-alt", stand: 1 }
  REG.spells.feuer = { spellId: "s-alt", stand: 1 }
  for (const p of ALLE) p.locked = true
}

/*
 * Die Installationswege, nachgebaut nach beneos_cloud.js: die Einzel-
 * installation entsperrt ihre Kompendien selbst und sperrt sie im finally,
 * die Sammelinstallation entsperrt alle vier einmal und sperrt sie nach dem
 * letzten Auftrag. Jeder Auftrag laeuft ueber die Kette wie enqueueInstall.
 */
async function schreibeToken(key) {
  const alt = REG.tokens[key]?.actorId
  if (alt && ACTOR.docs.has(alt)) await ACTOR.loesche(alt)
  const id = neueId("a")
  await ACTOR.lege(id)
  await JOURNAL.lege(neueId("j"))
  REG.tokens[key] = { actorId: id, stand: zaehler }
}
async function schreibeItem(key, pack, reg, feld) {
  const id = neueId(feld[0])
  await pack.lege(id)
  reg[key] = { [feld]: id, stand: zaehler }
}

function installiereToken(key, isBatch = false) {
  return inDerKette(async () => {
    if (!isBatch) await entsperre([ACTOR, JOURNAL])
    let gesperrt = false
    try {
      await schreibeToken(key)
      if (!isBatch) { await sperre([ACTOR, JOURNAL]); gesperrt = true }
    } finally {
      if (!isBatch && !gesperrt) await sperre([ACTOR, JOURNAL])
    }
  }).catch((e) => { fehler.push(`token ${key}: ${e.message}`) })
}
function installiereItem(key, pack, reg, feld, isBatch = false) {
  return inDerKette(async () => {
    if (!isBatch) await entsperre([pack])
    let gesperrt = false
    try {
      await schreibeItem(key, pack, reg, feld)
      if (!isBatch) { await sperre([pack]); gesperrt = true }
    } finally {
      if (!isBatch && !gesperrt) await sperre([pack])
    }
  }).catch((e) => { fehler.push(`${feld} ${key}: ${e.message}`) })
}
async function sammelinstallation(keys, mitte) {
  await entsperre(ALLE)
  try {
    const offen = []
    for (const k of keys) {
      offen.push(installiereToken(k, true))
      await takt()
    }
    if (mitte) await mitte()
    await Promise.allSettled(offen)
  } finally {
    await sperre(ALLE)
  }
}

/*
 * Der Schreibteil von verify, gebaut wie in beneos_utility.js: je Eintrag
 * der Stand zur Zeit der Pruefung, das Loeschen und die Registry. Die
 * Pruefphase selbst (Dateiproben) ist hier nicht nachgebaut.
 */
function pruefung(verwerfen) {
  const eintraege = verwerfen.map(([art, key, pack]) => {
    const reg = () => REG[art]
    const eintrag = REG[art][key]
    const id = eintrag?.actorId ?? eintrag?.itemId ?? eintrag?.spellId
    return {
      registry: reg, key, stand: JSON.stringify(eintrag),
      loesche: pack ? () => pack.loesche(id) : null,
    }
  })
  return verwirfImRiegel({
    packs: ALLE,
    eintraege,
    nachher: async () => { await takt() },
  }).catch((e) => { fehler.push(`verify: ${e.message}`) })
}

// ═══════════════════════════════════════════════════════════ Lage A ════════

console.log("\nLage A, die Wege gegeneinander gefahren")

beginne("A1")
frisch(); await bestand()
await Promise.all([
  pruefung([["tokens", "kreatur", ACTOR]]),
  installiereToken("zweite"),
])
pruefe("A1 Einzelinstallation waehrend verify laeuft fehlerfrei",
  fehler.length === 0, fehler.join(" | ") || "keine Fehler")
pruefe("A1b danach sind alle vier Kompendien gesperrt",
  alleZu(), `offen: ${offenListe()}`)

beginne("A2")
// GEGENPROBE: ohne verify aendert sich nichts. Die Installation entsperrt und
// sperrt genau ihre zwei Kompendien, einmal.
frisch(); await bestand()
await installiereToken("zweite")
pruefe("A2 ohne verify: dieselbe Installation, dieselbe Spur",
  fehler.length === 0 && alleZu()
    && ACTOR.spur.join(",") === "auf,zu" && JOURNAL.spur.join(",") === "auf,zu"
    && ITEM.spur.length === 0 && SPELL.spur.length === 0
    && REG.tokens.zweite?.actorId !== undefined,
  `actor ${ACTOR.spur.join(",")} · journal ${JOURNAL.spur.join(",")} · `
  + `items ${ITEM.spur.length} · spells ${SPELL.spur.length} · Fehler ${fehler.length}`)

beginne("A3")
frisch(); await bestand()
await Promise.all([
  pruefung([["items", "schwert", ITEM], ["tokens", "kreatur", ACTOR]]),
  installiereItem("axt", ITEM, REG.items, "itemId"),
])
pruefe("A3 Item-Installation waehrend verify laeuft fehlerfrei, alles gesperrt",
  fehler.length === 0 && alleZu(),
  `${fehler.join(" | ") || "keine Fehler"} · offen: ${offenListe()}`)

beginne("A4")
frisch(); await bestand()
await Promise.all([
  pruefung([["spells", "feuer", SPELL]]),
  installiereItem("eis", SPELL, REG.spells, "spellId"),
])
pruefe("A4 Spell-Installation waehrend verify laeuft fehlerfrei, alles gesperrt",
  fehler.length === 0 && alleZu(),
  `${fehler.join(" | ") || "keine Fehler"} · offen: ${offenListe()}`)

beginne("A5")
frisch(); await bestand()
let mitten = null
await sammelinstallation(["s1", "s2", "s3"], async () => {
  await pruefung([["items", "schwert", ITEM]])
  mitten = { actor: ACTOR.locked, journal: JOURNAL.locked }
})
pruefe("A5 Sammelinstallation mit verify dazwischen laeuft fehlerfrei",
  fehler.length === 0 && ["s1", "s2", "s3"].every((k) => REG.tokens[k]),
  fehler.join(" | ") || "drei Kreaturen eingetragen")
pruefe("A5b verify sperrt die Kompendien nicht unter der Sammlung zu",
  mitten !== null && mitten.actor === false && mitten.journal === false,
  `nach verify: actor ${mitten?.actor ? "gesperrt" : "offen"}, journal ${mitten?.journal ? "gesperrt" : "offen"}`)
pruefe("A5c nach der Sammlung sind alle vier gesperrt",
  alleZu(), `offen: ${offenListe()}`)

beginne("A6")
// Die Id ist schon weg, etwa weil eine Installation die Kreatur ersetzt hat.
frisch(); await bestand()
ACTOR.docs.delete("a-alt")
await pruefung([["tokens", "kreatur", ACTOR]])
pruefe("A6 eine schon fehlende Id wird geschluckt, die Registry bereinigt",
  fehler.length === 0 && REG.tokens.kreatur === undefined && alleZu(),
  `${fehler.join(" | ") || "keine Fehler"} · Eintrag ${REG.tokens.kreatur ? "noch da" : "weg"}`)

beginne("A7")
// Ein anderer Fehler: das Loeschen wirft etwas, das kein "does not exist" ist.
frisch(); await bestand()
const vorher = JSON.stringify(REG)
const eintragA7 = REG.tokens.kreatur
let gefangen = null
await verwirfImRiegel({
  packs: ALLE,
  eintraege: [{
    registry: () => REG.tokens, key: "kreatur", stand: JSON.stringify(eintragA7),
    loesche: async () => { await takt(); throw new Error("Datenbank nicht erreichbar") },
  }],
}).catch((e) => { gefangen = e.message })
pruefe("A7 ein anderer Fehler wird weitergeworfen",
  gefangen === "Datenbank nicht erreichbar", `gefangen: ${gefangen}`)
pruefe("A7b und die Kompendien sind trotzdem gesperrt",
  alleZu(), `offen: ${offenListe()}`)
pruefe("A8 bei Fehlschlag bleibt die Registry unveraendert",
  JSON.stringify(REG) === vorher,
  JSON.stringify(REG) === vorher ? "unveraendert" : `jetzt ${JSON.stringify(REG)}`)

beginne("A9")
// Die Kette: verify zuerst gestartet, die Neuinstallation derselben Kreatur
// direkt dahinter. Ohne Kette laeuft die Installation mitten in die
// Loeschungen, und verify streicht danach den frischen Eintrag.
frisch(); await bestand()
await Promise.all([
  pruefung([["tokens", "kreatur", ACTOR]]),
  installiereToken("kreatur"),
])
const neuA9 = REG.tokens.kreatur?.actorId
pruefe("A9 eine waehrend verify installierte Kreatur behaelt Eintrag und Actor",
  fehler.length === 0 && neuA9 !== undefined && neuA9 !== "a-alt" && ACTOR.docs.has(neuA9),
  `${fehler.join(" | ") || "keine Fehler"} · Eintrag ${neuA9 ?? "WEG"}`
  + ` · Actor ${neuA9 && ACTOR.docs.has(neuA9) ? "da" : "fehlt"}`)

beginne("A10")
// Der Standvergleich: die Kreatur wurde zwischen Pruefung und Schreibteil neu
// installiert. Der Schreibteil darf den neuen Eintrag nicht verwerfen.
frisch(); await bestand()
const altA10 = { registry: () => REG.tokens, key: "kreatur", stand: JSON.stringify(REG.tokens.kreatur),
  loesche: () => ACTOR.loesche("a-alt") }
await installiereToken("kreatur")
const neuA10 = REG.tokens.kreatur?.actorId
await verwirfImRiegel({ packs: ALLE, eintraege: [altA10] })
  .catch((e) => { fehler.push(`verify: ${e.message}`) })
pruefe("A10 ein inzwischen neu installierter Eintrag wird nicht verworfen",
  fehler.length === 0 && REG.tokens.kreatur?.actorId === neuA10 && ACTOR.docs.has(neuA10),
  `${fehler.join(" | ") || "keine Fehler"} · Eintrag ${REG.tokens.kreatur?.actorId ?? "WEG"}`)

beginne("A11")
// Der Zaehler: zwei Entsperrungen, die erste Sperrung sperrt noch nicht.
frisch()
await entsperre([ITEM])
await entsperre([ITEM])
await sperre([ITEM])
const nachEins = ITEM.locked
await sperre([ITEM])
pruefe("A11 erst die letzte Sperrung sperrt",
  nachEins === false && ITEM.locked === true && ITEM.spur.join(",") === "auf,zu",
  `nach der ersten Sperrung ${nachEins ? "gesperrt" : "offen"}, Spur ${ITEM.spur.join(",")}`)

beginne("A12")
// Die Kette reisst nach einem Fehler nicht ab.
const erst = inDerKette(async () => { throw new Error("erster Auftrag scheitert") })
  .catch((e) => e.message)
const dann = await inDerKette(async () => "zweiter Auftrag lief")
pruefe("A12 nach einem gescheiterten Auftrag laeuft der naechste",
  (await erst) === "erster Auftrag scheitert" && dann === "zweiter Auftrag lief",
  `erster: ${await erst} · zweiter: ${dann}`)

beginne("A13")
// Ein Entsperren scheitert. Der Zaehler darf nicht auf 1 stehen bleiben, sonst
// versucht kein spaeteres Entsperren es je wieder; schon geoeffnete Kompendien
// desselben Aufrufs gehen wieder zu.
frisch()
const zickig = JOURNAL.configure.bind(JOURNAL)
let einmal = true
JOURNAL.configure = async (o) => {
  if (einmal && o.locked === false) { einmal = false; await takt(); throw new Error("configure abgelehnt") }
  return zickig(o)
}
let a13 = null
await entsperre([ACTOR, JOURNAL]).catch((e) => { a13 = e.message })
const nachFehler = { actor: ACTOR.locked, journal: JOURNAL.locked }
await entsperre([JOURNAL])
const zweiterVersuch = JOURNAL.locked
await sperre([JOURNAL])
pruefe("A13 ein gescheitertes Entsperren nimmt seine Zaehlung zurueck",
  a13 === "configure abgelehnt" && nachFehler.actor === true && nachFehler.journal === true
    && zweiterVersuch === false && JOURNAL.locked === true,
  `Fehler ${a13} · danach actor ${nachFehler.actor ? "zu" : "OFFEN"}, journal ${nachFehler.journal ? "zu" : "OFFEN"}`
  + ` · zweiter Versuch ${zweiterVersuch ? "BLIEB ZU" : "entsperrt"}`)

beginne("A14")
// Teilerfolg: der erste Eintrag ist geloescht, der zweite scheitert hart. Der
// erste darf nicht auf ein geloeschtes Dokument zeigen, der zweite bleibt.
frisch(); await bestand()
let a14 = null, a14nachher = null
await verwirfImRiegel({
  packs: ALLE,
  eintraege: [
    { registry: () => REG.items, key: "schwert", stand: JSON.stringify(REG.items.schwert),
      loesche: () => ITEM.loesche("i-alt") },
    { registry: () => REG.spells, key: "feuer", stand: JSON.stringify(REG.spells.feuer),
      loesche: async () => { await takt(); throw new Error("Datenbank nicht erreichbar") } },
  ],
  nachher: async (n) => { a14nachher = n },
}).catch((e) => { a14 = e.message })
pruefe("A14 nach einem Teilerfolg faellt genau das Erledigte aus der Registry",
  a14 === "Datenbank nicht erreichbar" && REG.items.schwert === undefined && !ITEM.docs.has("i-alt")
    && REG.spells.feuer?.spellId === "s-alt" && a14nachher === 1 && alleZu(),
  `Fehler ${a14} · schwert ${REG.items.schwert ? "NOCH DA" : "weg"} · feuer ${REG.spells.feuer ? "da" : "WEG"}`
  + ` · nachher(${a14nachher}) · offen: ${offenListe()}`)

beginne("A15")
// Das Wiedersperren scheitert am ersten Kompendium. Die uebrigen muessen
// trotzdem zugehen, und das schon Geloeschte faellt trotzdem aus der Registry.
frisch(); await bestand()
const zickigZu = ACTOR.configure.bind(ACTOR)
let einmalZu = true
ACTOR.configure = async (o) => {
  if (einmalZu && o.locked === true) { einmalZu = false; await takt(); throw new Error("Sperren abgelehnt") }
  return zickigZu(o)
}
let a15 = null, a15nachher = null
await verwirfImRiegel({
  packs: ALLE,
  eintraege: [{ registry: () => REG.items, key: "schwert", stand: JSON.stringify(REG.items.schwert),
    loesche: () => ITEM.loesche("i-alt") }],
  nachher: async (n) => { a15nachher = n },
}).catch((e) => { a15 = e.message })
pruefe("A15 scheitert ein Wiedersperren, gehen die uebrigen trotzdem zu",
  a15 === "Sperren abgelehnt" && JOURNAL.locked && ITEM.locked && SPELL.locked
    && REG.items.schwert === undefined && a15nachher === 1,
  `Fehler ${a15} · offen: ${offenListe()} · schwert ${REG.items.schwert ? "NOCH DA" : "weg"} · nachher(${a15nachher})`)
await sperre([ACTOR])

beginne("A16")
// Zwei Aufrufer gleichzeitig: der zweite darf erst zurueckkehren, wenn das
// Oeffnen des ersten fertig ist, sonst schreibt er in ein gesperrtes Kompendium.
frisch()
let a16 = null
const ersterA16 = entsperre([JOURNAL])
await entsperre([JOURNAL])
a16 = JOURNAL.locked
await ersterA16
await sperre([JOURNAL]); await sperre([JOURNAL])
pruefe("A16 ein zweiter Aufrufer wartet auf das laufende Oeffnen",
  a16 === false && JOURNAL.locked === true && JOURNAL.spur.join(",") === "auf,zu",
  `beim Zurueckkehren des zweiten ${a16 ? "NOCH GESPERRT" : "offen"} · Spur ${JOURNAL.spur.join(",")}`)

// ─────────────────────────────────────────── Nachschaerfung stre-T-485 ─────
//
// Ein Wiedereintritt in die Kette aus einem laufenden Auftrag wartete still
// auf sich selbst und hielt danach jeden Folgeauftrag an (CQ-R-06). Jede
// Probe hat deshalb eine Zeitgrenze: ohne die Pruefung waere ein Satz sonst
// kein roter Satz, sondern ein haengender Bench.

const fehltA = (n, f) => typeof f === "function" ? "" : `${n} FEHLT IM RIEGEL`
const ZEITGRENZE_MS = 500
function zeitgrenze(p) {
  return Promise.race([
    Promise.resolve(p).then((v) => v, (e) => `abgelehnt: ${e?.message ?? e}`),
    new Promise((r) => setTimeout(() => r("HAENGT"), ZEITGRENZE_MS)),
  ])
}
// Ruft die Kette und meldet "warf", wenn der Aufruf selbst wirft, sonst das
// Ergebnis innerhalb der Zeitgrenze.
async function ruf(aufruf) {
  let glied
  try { glied = aufruf() } catch { return "warf" }
  return zeitgrenze(glied)
}

beginne("A17")
// Die Messfaelle des Wiedereintritts. Abgewiesen wird mit einer abgelehnten
// Promise, nie mit einem synchronen Wurf ("warf" ist rot). Der letzte Fall
// ist die bekannte Grenze: aus einem setTimeout-Rueckruf fehlt der
// asynchrone Stapel, der Aufruf reiht sich ein wie vor stre-T-485.
const abgewiesen = (v) => typeof v === "string" && v.startsWith("abgelehnt: kompendium-riegel: re-entry")
// Das Riegel-Modul protokolliert jede Abweisung; im Bench waere das Laerm.
const a17errorAlt = console.error
console.error = () => { }
const a17 = {}
a17.innenNachAwait = await zeitgrenze(inDerKette(async () => {
  await takt()
  const tief = async () => { await takt(); return ruf(() => inDerKette(async () => "innen")) }
  return tief()
}))
a17.innenAusThen = await zeitgrenze(inDerKette(() => takt().then(() => ruf(() => inDerKette(async () => "innen")))))
// Tiefer als das uebliche Stapellimit von 10 Rahmen. Das `return await` ist
// noetig: ohne await entsteht kein asynchroner Stapelrahmen, und die Probe
// waere flach (gemessen: ohne await bleibt die Marke in jeder Tiefe sichtbar,
// mit await faellt sie bei Limit 10 ab Tiefe 8 heraus).
async function tiefRuf(n) {
  await takt()
  return n === 0 ? ruf(() => inDerKette(async () => "innen")) : await tiefRuf(n - 1)
}
a17.tief12 = await zeitgrenze(inDerKette(() => tiefRuf(12)))
// Ohne await: der laufende Auftrag laeuft zu Ende, die Abweisung erreicht
// das angehaengte catch.
let a17ohneAwait = null
a17.ohneAwaitAuftrag = await zeitgrenze(inDerKette(async () => {
  inDerKette(async () => "innen").then(() => { a17ohneAwait = "lief" }, (e) => { a17ohneAwait = `abgelehnt: ${e.message}` })
  await takt()
  return "Auftrag fertig"
}))
await takte(3)
a17.ohneAwaitCatch = a17ohneAwait
let a17halt
const a17lauf = inDerKette(() => new Promise((r) => { a17halt = r }))
const a17aussen = ruf(() => inDerKette(async () => "aussen"))
await takte(3)
a17halt()
await a17lauf
a17.aussenWaehrendLauf = await a17aussen
let a17spaet = null
await zeitgrenze(inDerKette(() => new Promise((r) => setTimeout(() => {
  try { a17spaet = inDerKette(async () => "spaet") } catch { a17spaet = Promise.resolve("warf") }
  r()
}, 1))))
a17.ausTimeout = await zeitgrenze(a17spaet)
console.error = a17errorAlt
pruefe("A17 ein Wiedereintritt aus einem Auftrag wird abgewiesen, ein Aufruf von aussen reiht sich ein",
  abgewiesen(a17.innenNachAwait) && abgewiesen(a17.innenAusThen) && abgewiesen(a17.tief12)
    && a17.ohneAwaitAuftrag === "Auftrag fertig" && abgewiesen(a17.ohneAwaitCatch)
    && a17.aussenWaehrendLauf === "aussen" && a17.ausTimeout === "spaet",
  Object.entries(a17).map(([k, v]) => `${k}: ${abgewiesen(v) ? "abgewiesen" : v}`).join(" · "))

beginne("A18")
// Der Auftrag wartet OHNE Zeitgrenze auf seinen Wiedereintritt, so wie ein
// echter Fehler es taete. Der Folgeauftrag muss trotzdem laufen.
const a18errorAlt = console.error
console.error = () => { }
const a18haenger = inDerKette(async () => {
  await takt()
  return await inDerKette(async () => "innen")
}).then(() => "lief", () => "abgewiesen")
const a18folge = await zeitgrenze(inDerKette(async () => "weiter"))
const a18erst = await zeitgrenze(a18haenger)
console.error = a18errorAlt
pruefe("A18 nach einem abgewiesenen Wiedereintritt laeuft der Folgeauftrag",
  a18folge === "weiter" && a18erst === "abgewiesen",
  `Folgeauftrag: ${a18folge} · Auftrag mit Wiedereintritt: ${a18erst}`)

beginne("A19")
// Der erste Fehler kommt beim Aufrufer an (F3). Nachgebaut nach den drei
// Importfunktionen: catch haelt den Wurf fest, das finally sperrt ueber
// sperreNach.
const a19fehlt = fehltA("sperreNach", sperreNach)
function sturerPack(id) {
  const p = new Pack(id)
  p.configure = async ({ locked }) => {
    await takt()
    if (locked) throw new Error("Sperren abgelehnt")
    p.locked = false
  }
  return p
}
async function importNachbau(packs, rumpfWirft) {
  await entsperre(packs)
  let gesperrt = false
  let wurf = null
  try {
    if (rumpfWirft) throw new Error("Rumpf gescheitert")
    await sperre(packs)
    gesperrt = true
  } catch (f) {
    wurf = f
    throw f
  } finally {
    if (!gesperrt) await sperreNach(packs, wurf)
  }
}
const a19protokoll = []
const errorAlt = console.error
console.error = (...a) => { a19protokoll.push(a.map((x) => String(x?.message ?? x)).join(" ")) }
let a19rumpf = null, a19nurSperre = null, a19direkt = null
try {
  if (!a19fehlt) {
    a19rumpf = await importNachbau([sturerPack("x1")], true).then(() => "kein Fehler", (e) => e.message)
    a19nurSperre = await importNachbau([sturerPack("x2")], false).then(() => "kein Fehler", (e) => e.message)
    a19direkt = await sperreNach([sturerPack("x3")], null).then(() => "kein Fehler", (e) => e.message)
  }
} finally {
  console.error = errorAlt
}
pruefe("A19 der erste Fehler kommt an, der Sperrfehler steht im Protokoll",
  !a19fehlt && a19rumpf === "Rumpf gescheitert" && a19nurSperre === "Sperren abgelehnt"
    && a19direkt === "Sperren abgelehnt" && a19protokoll.some((z) => z.includes("Sperren abgelehnt")),
  a19fehlt || `Rumpf und Sperre scheitern: ${a19rumpf} · nur Sperre: ${a19nurSperre} · ohne ersten Fehler: ${a19direkt} · Protokoll ${a19protokoll.length} Zeile(n)`)

beginne("A20")
// Der Wartehinweis: bei freier Kette keiner, bei belegter genau einer, und
// bei einem offenen Dialog im Auftrag mit dialogOffen.
const a20fehlt = fehltA("wartetAufNutzer", wartetAufNutzer)
const a20 = { frei: [], belegt: [], dialog: [], danach: [], wurfErgebnis: null, dialogErgebnis: null }
if (!a20fehlt) {
  await zeitgrenze(inDerKette(async () => "a", { beimWarten: (i) => a20.frei.push(i) }))
  let halt
  const h1 = inDerKette(() => new Promise((r) => { halt = r }))
  const b1 = inDerKette(async () => "b", { beimWarten: (i) => a20.belegt.push(i) })
  await takte(3); halt(); await zeitgrenze(h1); await zeitgrenze(b1)

  let antwort
  const dlg = inDerKette(() => wartetAufNutzer(new Promise((r) => { antwort = r })))
  await takte(3)
  const c1 = inDerKette(async () => "c", { beimWarten: (i) => a20.dialog.push(i) })
  antwort("ja"); a20.dialogErgebnis = await zeitgrenze(dlg); await zeitgrenze(c1)

  const h2 = inDerKette(() => new Promise((r) => { halt = r }))
  const d1 = inDerKette(async () => "d", { beimWarten: (i) => a20.danach.push(i) })
  await takte(3); halt(); await zeitgrenze(h2); await zeitgrenze(d1)

  const h3 = inDerKette(() => new Promise((r) => { halt = r }))
  const w1 = inDerKette(async () => "lief trotzdem", { beimWarten: () => { throw new Error("Hinweis kaputt") } })
  await takte(3); halt(); await zeitgrenze(h3); a20.wurfErgebnis = await zeitgrenze(w1)
}
const a20eins = (l, offen) => l.length === 1 && l[0]?.dialogOffen === offen
pruefe("A20 der Wartehinweis kommt nur bei belegter Kette und nennt den offenen Dialog",
  !a20fehlt && a20.frei.length === 0 && a20eins(a20.belegt, false) && a20eins(a20.dialog, true)
    && a20eins(a20.danach, false) && a20.dialogErgebnis === "ja" && a20.wurfErgebnis === "lief trotzdem",
  a20fehlt || `frei ${a20.frei.length} · belegt ${JSON.stringify(a20.belegt)} · Dialog ${JSON.stringify(a20.dialog)} · danach ${JSON.stringify(a20.danach)} · Hinweis wirft: ${a20.wurfErgebnis}`)

beginne("A21")
// Ein zweiter Klick auf dasselbe Asset reiht sich nicht ein, ein Klick auf
// ein anderes schon; nach dem Ende, auch nach einem Fehler, ist der
// Schluessel wieder frei.
const a21fehlt = fehltA("einmalJe", einmalJe)
const a21 = {}
if (!a21fehlt) {
  let loese
  let zweitGerufen = 0
  const erst = einmalJe("remove:a", () => new Promise((r) => { loese = r }))
  a21.zweit = await zeitgrenze(einmalJe("remove:a", async () => { zweitGerufen++; return "zweit" }))
  a21.anders = await zeitgrenze(einmalJe("remove:b", async () => "b"))
  loese("a")
  a21.erst = await zeitgrenze(erst)
  a21.wieder = await zeitgrenze(einmalJe("remove:a", async () => "wieder"))
  a21.wurf = await zeitgrenze(einmalJe("remove:c", async () => { throw new Error("Entfernen scheitert") }))
  a21.nachWurf = await zeitgrenze(einmalJe("remove:c", async () => "c"))
  a21.zweitGerufen = zweitGerufen
}
pruefe("A21 derselbe Schluessel laeuft nur einmal, ein anderer laeuft",
  !a21fehlt && a21.zweit?.lief === false && a21.zweitGerufen === 0
    && a21.anders?.lief === true && a21.anders?.ergebnis === "b"
    && a21.erst?.lief === true && a21.erst?.ergebnis === "a"
    && a21.wieder?.lief === true && a21.wurf === "abgelehnt: Entfernen scheitert" && a21.nachWurf?.lief === true,
  a21fehlt || JSON.stringify(a21))

beginne("A22")
// Der Text des Wartehinweises: bei offenem Dialog der Dialogschluessel, sonst
// der neutrale. Ein Vorgang ueber mehrere Packs meldet nur einmal. ui und game
// sind Attrappen, die nur festhalten, was gezeigt wurde.
const a22gezeigt = []
const a22alt = { ui: globalThis.ui, game: globalThis.game }
globalThis.ui = { notifications: { info: (t) => a22gezeigt.push(t) } }
globalThis.game = { i18n: { localize: (k) => `<${k}>` } }
const a22 = {}
try {
  const { wartehinweis, einmalHinweis } = await import(pathToFileURL(join(WURZEL, "scripts", "kompendium-wartehinweis.mjs")).href)
  wartehinweis({ dialogOffen: false })
  wartehinweis({ dialogOffen: true })
  a22.ohneUndMit = a22gezeigt.splice(0)
  const einmal = einmalHinweis()
  einmal({ dialogOffen: false })
  einmal({ dialogOffen: true })
  a22.einmal = a22gezeigt.splice(0)
  const zweiterVorgang = einmalHinweis()
  zweiterVorgang({ dialogOffen: true })
  a22.zweiterVorgang = a22gezeigt.splice(0)
} catch (e) {
  a22.fehler = e.message
} finally {
  globalThis.ui = a22alt.ui
  globalThis.game = a22alt.game
}
const A22_TASK = "<BENEOS.Cloud.Notification.WaitingForTask>"
const A22_DIALOG = "<BENEOS.Cloud.Notification.WaitingForDialog>"
pruefe("A22 der Wartehinweis nennt den Dialog nur bei offenem Dialog und meldet je Vorgang einmal",
  !a22.fehler && JSON.stringify(a22.ohneUndMit) === JSON.stringify([A22_TASK, A22_DIALOG])
    && JSON.stringify(a22.einmal) === JSON.stringify([A22_TASK])
    && JSON.stringify(a22.zweiterVorgang) === JSON.stringify([A22_DIALOG]),
  JSON.stringify(a22))

// ═══════════════════════════════════════════════════════════ Lage B ════════
//
// Der Quelltext. Ohne Foundry erreicht kein Lauf beneos_cloud.js und
// beneos_utility.js; ob sie den Riegel benutzen, steht nur dort.

console.log("\nLage B, die Wege benutzen den Riegel")

function nurCode(text) {
  return text.split("\n").filter((z) => {
    const t = z.trim()
    return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")
  }).join("\n")
}
const cloud = nurCode(readFileSync(CLOUD, "utf8"))
const utility = nurCode(readFileSync(UTILITY, "utf8"))

// Eine Methode schneiden: von `  async <name>(` oder `  static async <name>(`
// bis zum naechsten Methodenkopf auf zwei Leerzeichen Einrueckung.
function methode(text, name) {
  const kopf = new RegExp(`\\n  (?:static )?(?:async )?${name}\\(`).exec(text)
  if (!kopf) return null
  const rest = text.slice(kopf.index + 1)
  const naechster = /\n  (?:static )?(?:async )?[A-Za-z_#$][\w$]*\([^)\n]*\)\s*\{/.exec(rest.slice(3))
  return naechster ? rest.slice(0, naechster.index + 3) : rest
}

// Jede Sperrstelle im ganzen Modul, Tests ausgenommen. Erlaubt ist sie nur
// im Riegel selbst.
function alleSkripte(dir) {
  const aus = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) aus.push(...alleSkripte(p))
    else if (/\.m?js$/.test(e.name) && !/\.test\.m?js$/.test(e.name)) aus.push(p)
  }
  return aus
}
// Jeder Aufruf von configure zaehlt, unabhaengig von Leerzeichen, der
// Reihenfolge der Schluessel, optionalem Aufruf oder Klammerzugriff, und
// auch mit einer Variablen als Argument (MO-051). Ob das Ziel ein Pack ist,
// laesst sich am Text nicht sehen; deshalb ist ausserhalb des Riegels jeder
// configure-Aufruf ein Befund, bis er hier begruendet ausgenommen wird.
const CONFIGURE = /(?:\bconfigure|\[\s*["'`]configure["'`]\s*\])\s*(?:\?\.)?\s*\(/
const sperrstellen = alleSkripte(join(WURZEL, "scripts")).flatMap((datei) =>
  nurCode(readFileSync(datei, "utf8")).split("\n")
    .filter((z) => CONFIGURE.test(z) && !/\bfunction\s+configure\b|^\s*(?:async\s+)?configure\s*\([^)]*\)\s*\{/.test(z))
    .map((z) => ({ datei: relative(WURZEL, datei).replaceAll("\\", "/"), zeile: z.trim() })))
const imRiegel = sperrstellen.filter((s) => s.datei === "scripts/kompendium-riegel.mjs")
const ausserhalb = sperrstellen.filter((s) => s.datei !== "scripts/kompendium-riegel.mjs")
pruefe("B1 kein Skript sperrt mehr an den Riegeln vorbei",
  ausserhalb.length === 0,
  ausserhalb.length === 0 ? "kein configure-Aufruf ausserhalb des Riegels"
    : `${ausserhalb.length} Stelle(n): ${ausserhalb.map((s) => `${s.datei}: ${s.zeile.slice(0, 60)}`).join(" | ")}`)
// GEGENPROBE: die zwei Stellen im Riegel selbst muss dieselbe Suche finden,
// und beide setzen locked als festen Wert. Findet die Suche sie nicht, sucht
// sie nicht mehr, und B1 waere leer gruen; ein Argument als Variable liesse
// offen, was gesetzt wird.
const festeSperre = imRiegel.filter((s) => /\.configure\(\{ locked: (?:true|false) \}\)/.test(s.zeile))
pruefe("B2 die Suche findet die zwei Sperrstellen im Riegel, beide mit festem Wert",
  imRiegel.length === 2 && festeSperre.length === 2,
  `${imRiegel.length} von 2 gefunden, ${festeSperre.length} mit festem Wert`
    + (festeSperre.length < imRiegel.length ? `: ${imRiegel.filter((s) => !festeSperre.includes(s)).map((s) => s.zeile.slice(0, 60)).join(" | ")}` : ""))

// Die drei Wege, die ausserhalb der Installation schreiben, laufen in der
// Kette und lesen die Sperre erst dort.
const repair = nurCode(readFileSync(join(WURZEL, "scripts", "beneos-asset-path-repair.js"), "utf8"))
const fenster = nurCode(readFileSync(join(WURZEL, "scripts", "cloud-v2", "cloud-window-v2.mjs"), "utf8"))
const familie = /async function _familieNachziehen\([\s\S]*?\n\}/.exec(repair)?.[0] ?? null
const ausPack = methode(fenster, "#deleteFromPack")
const waisen = methode(cloud, "runOrphanCleanup")
const wege = [
  ["_familieNachziehen", familie, /const schreibe = async \(\) => \{\s*const warGesperrt[\s\S]*return fam\.pack \? inDerKette\(schreibe(?:, \{ beimWarten(?:: wartehinweis)? \})?\) : schreibe\(\);/],
  ["#deleteFromPack", ausPack, /return inDerKette\(async \(\) => \{[\s\S]{0,120}const wasLocked/],
  ["runOrphanCleanup", waisen, /inDerKette\(async \(\) => \{\s*const wasLocked[\s\S]{0,200}finally \{\s*if \(wasLocked\) await sperre(?:Nach)?\(/],
]
const verfehlt = wege.filter(([, text, muster]) => text === null || !muster.test(text)).map(([n, text]) => text === null ? `${n} NICHT GESCHNITTEN` : n)
pruefe("B15 Heilung, Entfernen und Waisenbereinigung schreiben in der Kette",
  verfehlt.length === 0, verfehlt.length === 0 ? "3 von 3" : `fehlt: ${verfehlt.join(", ")}`)

const enqueue = methode(cloud, "enqueueInstall")
pruefe("B3 enqueueInstall gibt an die gemeinsame Kette",
  enqueue !== null && /return inDerKette\(job\)/.test(enqueue),
  enqueue === null ? "NICHT GESCHNITTEN" : enqueue.split("\n").slice(0, 3).join(" ").trim().slice(0, 100))

const verify = methode(utility, "verifySettingsAgainstCompendium")
pruefe("B4 verify verwirft ueber den Riegel",
  verify !== null && /verwirfImRiegel\(/.test(verify) && !/lockUnlockAllPacks/.test(verify),
  verify === null ? "NICHT GESCHNITTEN" : "")
// Ausgenommen ist der Spielerzweig: ein Spieler loescht nichts im Kompendium,
// ihm wird nur die Registry im Speicher bereinigt, wie vorher.
const spielerZweig = /if \(!game\.user\.isGM\) \{[^}]*?return\n\s*\}/
const verifyOhneSpieler = verify === null ? null : verify.replace(spielerZweig, "")
pruefe("B5 verify streicht keinen Registry-Eintrag vor dem Loeschen",
  verify !== null && spielerZweig.test(verify)
    && !/delete this\.beneos(Tokens|Items|Spells)\[/.test(verifyOhneSpieler),
  verify === null ? "NICHT GESCHNITTEN"
    : spielerZweig.test(verify) ? "nur im Spielerzweig" : "Spielerzweig NICHT GEFUNDEN")

pruefe("B6 ready faengt die Ablehnung von createCompendiums",
  /this\.createCompendiums\(\)\s*\n?\s*\.catch\(/.test(utility), "")

const update = methode(cloud, "updateInstalledAssets")
pruefe("B7 updateInstalledAssets sperrt nicht mehr im Zeitgeber",
  update !== null && !/lockUnlockAllPacks/.test(update),
  update === null ? "NICHT GESCHNITTEN" : "")

const batch = methode(cloud, "batchInstall")
pruefe("B8 batchInstall sperrt awaited im finally, in der Kette",
  batch !== null && /finally \{[\s\S]{0,400}await inDerKette\(\(\) => BeneosUtility\.lockUnlockAllPacks\(true\)\)/.test(batch),
  batch === null ? "NICHT GESCHNITTEN" : "")
// batchInstall laeuft selbst in keinem Kettenauftrag; sein Ent- und Sperren
// als eigene Auftraege ueberlappt deshalb nie mit einem laufenden.
const aufStellen = batch === null ? [] : batch.split("\n").filter((z) => /lockUnlockAllPacks\(false\)/.test(z))
pruefe("B9 batchInstall entsperrt in der Kette",
  aufStellen.length === 1 && /await inDerKette\(\(\) => BeneosUtility\.lockUnlockAllPacks\(false\)\)/.test(aufStellen[0]),
  batch === null ? "NICHT GESCHNITTEN" : `${aufStellen.length} Entsperrstelle(n)`)

// Der Stand, gegen den der Schreibteil vergleicht, wird beim LESEN erfasst.
// Erst nach den Proben erfasst, traefe er einen Eintrag, den eine Installation
// in den rund 17 s dazwischen ersetzt hat (A10 zeigt die Folge am Modul).
const drops = verify === null ? [] : verify.split("\n").filter((z) => /(token|item|spell)Drop\.push\(fullKey\)/.test(z))
const mitStand = drops.filter((z) => /(token|item|spell)Stand\.set\(fullKey, JSON\.stringify\(/.test(z))
pruefe("B14 verify haelt den Stand beim Lesen fest",
  verify !== null && drops.length === 6 && mitStand.length === 6
    && /stand: stand\.get\(fullKey\)/.test(verify) && !/stand: JSON\.stringify\(/.test(verify),
  verify === null ? "NICHT GESCHNITTEN" : `${mitStand.length} von ${drops.length} Fundstellen mit Stand (soll 6 von 6)`)

for (const [name, kuerzel] of [["importTokenToCompendium", "B10"], ["importItemToCompendium", "B11"], ["importSpellToCompendium", "B12"]]) {
  const m = methode(cloud, name)
  pruefe(`${kuerzel} ${name} entsperrt ueber den Riegel und sperrt im finally`,
    m !== null && /await entsperre\(/.test(m) && /finally \{[\s\S]{0,300}await sperre(?:Nach)?\(/.test(m),
    m === null ? "NICHT GESCHNITTEN" : "")
}

const lul = methode(utility, "lockUnlockAllPacks")
pruefe("B13 lockUnlockAllPacks zaehlt ueber den Riegel",
  lul !== null && /entsperre\(/.test(lul) && /sperre\(/.test(lul) && !/configure\(/.test(lul),
  lul === null ? "NICHT GESCHNITTEN" : "")

// stre-T-485: der erste Fehler, der Wartehinweis und der Doppelklick.
const ERSTER_FEHLER = /catch \(f\) \{\s*wurf = f\s*throw f\s*\} finally \{/
const b16fehlt = [["importTokenToCompendium", "tokenGesperrt"], ["importItemToCompendium", "itemGesperrt"], ["importSpellToCompendium", "spellGesperrt"]]
  .filter(([name, marke]) => {
    const m = methode(cloud, name)
    return m === null || !/let wurf = null/.test(m) || !ERSTER_FEHLER.test(m)
      || !new RegExp(`if \\(!${marke}\\) await sperreNach\\(\\[[^\\]]+\\], wurf\\)`).test(m)
  }).map(([name]) => name)
pruefe("B16 die drei Importfunktionen bewahren den ersten Fehler",
  b16fehlt.length === 0, b16fehlt.length === 0 ? "3 von 3" : `fehlt: ${b16fehlt.join(", ")}`)

const b17waisen = waisen !== null && ERSTER_FEHLER.test(waisen) && /if \(wasLocked\) await sperreNach\(\[actorPack\], wurf\)/.test(waisen)
const b17batch = batch !== null && ERSTER_FEHLER.test(batch)
  && /lockUnlockAllPacks\(true\)\)\.catch\(\(f\) => \{\s*if \(!wurf\) throw f/.test(batch)
pruefe("B17 Waisenbereinigung und Sammelinstallation bewahren den ersten Fehler",
  b17waisen && b17batch, `runOrphanCleanup ${b17waisen ? "ja" : "NEIN"} · batchInstall ${b17batch ? "ja" : "NEIN"}`)

const propagiere = methode(cloud, "_propagateTokenUpdateToWorld")
const neuAufsetzen = methode(cloud, "_resetAndReinstall")
const b18 = propagiere !== null && neuAufsetzen !== null
  && /await wartetAufNutzer\(foundry\.applications\.api\.DialogV2\.wait\(\{\s*window: \{ title: game\.i18n\.localize\("BENEOS\.Cloud\.Update\.Title"\)/.test(propagiere)
  && /await wartetAufNutzer\(foundry\.applications\.api\.DialogV2\.wait\(/.test(neuAufsetzen)
pruefe("B18 die Dialoge im Installationsauftrag melden sich am Riegel",
  b18, propagiere === null || neuAufsetzen === null ? "NICHT GESCHNITTEN" : "")

// Familien-Nachzug und Entfernen reichen EINEN Hinweisgeber je Vorgang durch
// (einmalHinweis), damit ein Vorgang ueber mehrere Packs nur einmal meldet.
// Die Waisenbereinigung ist ein einzelner Auftrag.
const nachzug = /async function _restlicheWurzelnNachziehen\([\s\S]*?\n\}/.exec(repair)?.[0] ?? null
const entfernenRumpf = methode(fenster, "#removeAsset")
const b19wege = [
  ["_familieNachziehen", familie, /^async function _familieNachziehen\([^)]*\bbeimWarten\)[\s\S]*inDerKette\(schreibe, \{ beimWarten \}\)/],
  ["_restlicheWurzelnNachziehen", nachzug, /const hinweis = einmalHinweis\(\);[\s\S]*_familieNachziehen\(fam, abbildung, bericht, hinweis\)/],
  ["#deleteFromPack", ausPack, /^\s*static async #deleteFromPack\([^)]*\bbeimWarten = wartehinweis\)[\s\S]*\}, \{ beimWarten \}\)/],
  ["#removeAsset", entfernenRumpf, /const hinweis = einmalHinweis\(\)[\s\S]*#deleteFromPack\([^)]*, hinweis\)[\s\S]*#deleteFromPack\([^)]*, hinweis\)/],
  ["runOrphanCleanup", waisen, /\}, \{ beimWarten: wartehinweis \}\)/],
]
const b19fehlt = b19wege.filter(([, text, muster]) => text === null || !muster.test(text)).map(([n, text]) => text === null ? `${n} NICHT GESCHNITTEN` : n)
pruefe("B19 Heilung, Entfernen und Waisenbereinigung geben den Wartehinweis mit",
  b19fehlt.length === 0, b19fehlt.length === 0 ? `${b19wege.length} von ${b19wege.length}` : `fehlt: ${b19fehlt.join(", ")}`)

const entfernen = methode(fenster, "_onRemoveAsset")
pruefe("B20 Entfernen laeuft je Asset nur einmal",
  entfernen !== null && /einmalJe\(`remove:\$\{key\}`/.test(entfernen)
    && /BENEOS\.Cloud\.Card\.AlreadyRemoving/.test(entfernen),
  entfernen === null ? "NICHT GESCHNITTEN" : "")

console.log("")
console.log("NICHT PRUEFBAR: ob Foundry pack.configure unter Last so antwortet wie")
console.log("die Attrappe, und die Dateiproben von verify. Beides braucht ein")
console.log("laufendes Foundry.")
console.log("")
console.log(`Ergebnis: ${gruen} gehalten, ${rot} Befund(e).`)
process.exit(rot === 0 ? 0 : 1)
