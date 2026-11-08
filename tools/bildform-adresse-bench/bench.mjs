/*
 * bildform-adresse-bench
 *
 * Haelt den Bildweg des Installers (`scripts/beneos_cloud.js`) fest. Laeuft
 * ohne Foundry und ohne Netz:
 *
 *   node tools/bildform-adresse-bench/bench.mjs
 *
 * Rueckgabewert 0 heisst alle Saetze gruen, 1 heisst mindestens einer rot.
 *
 * WARUM ER ENTSTANDEN IST, am 08.11.2026 mit `OP-PRJ-146`. Der Installer hat
 * jede Bilddatei als base64 AUS DEM JSON gelesen. Gemessen auf der
 * Serverseite: Median 1,19 MB je Kreatur, Maximum 20,4 MB in EINER Antwort.
 * `OP-PRJ-190` hat gemessen, dass `030-commoner_male` mit zwanzig Varianten
 * sich NICHT installieren laesst und die Ursache auf dem Weg zwischen Hoster
 * und Anschluss des Kunden liegt, wo von beiden Enden niemand messen kann.
 *
 * Der Server liefert auf `?bildform=adresse` je Datei eine Adresse statt der
 * Bytes, gebaut in `9f0a9cf` in `beneos-cloud-server`.
 *
 * ─── DER GEFAEHRLICHSTE TEIL IST NICHT DER ABRUF, SONDERN DIE VORPRUEFUNG ───
 *
 * Drei Stellen fragten vor dem Hochladen `if (!X.image64) continue`. Mit
 * Adressen ist `image64` dort IMMER `null`, und die Bedingung waere immer
 * wahr gewesen: der Installer haette jede Datei uebersprungen, ohne eine
 * Zeile zu meckern. Eine Reparatur haette "nichts zu reparieren" gemeldet,
 * eine Installation waere leer durchgelaufen, und der Kunde haette eine
 * Kreatur ohne Bilder bekommen.
 *
 * Deshalb zaehlt Lage C die Vorkommen von `image64` im Quelltext nach. Die
 * Zahl ist der Satz, nicht die Abwesenheit: eine Suche, die nichts findet,
 * ist von einer kaputten Suche nicht zu unterscheiden.
 *
 * ─── WAS AM VERHALTEN GEMESSEN WIRD UND WAS NUR AM QUELLTEXT ───────────────
 *
 * `_beneosBildDa()` und `_beneosBildDatei()` werden aus der Datei
 * GESCHNITTEN und wirklich gefahren, mit einem nachgebauten `fetch` und einem
 * nachgebauten `File`. Ein `import` der Datei waere falsch: sie ruft beim
 * Laden Foundry-Globale und haette hier gar nicht laufen koennen.
 *
 * Die Lage der Aufrufe, der Schalter und die Zahl der Stellen sind am
 * Quelltext gemessen, denn ein Lauf ohne Foundry erreicht sie nicht.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HIER = dirname(fileURLToPath(import.meta.url))
const CLOUD = join(HIER, "..", "..", "scripts", "beneos_cloud.js")

let rot = 0
let gruen = 0

function pruefe(name, bedingung, auskunft) {
  if (bedingung) {
    gruen++
    console.log(`  ok   ${name}`)
    if (auskunft) console.log(`       ${auskunft}`)
  } else {
    rot++
    console.log(`  ROT  ${name}`)
    if (auskunft) console.log(`       ${auskunft}`)
  }
}

function gleich(name, ist, soll) {
  const o = JSON.stringify(ist) === JSON.stringify(soll)
  pruefe(name, o, o ? undefined
    : `soll ${JSON.stringify(soll)}, ist ${JSON.stringify(ist)}`)
}

const quelle = readFileSync(CLOUD, "utf8")

/*
 * Der Quelltext OHNE Kommentarzeilen.
 *
 * Eine Probe, die auf eine ABWESENHEIT zielt, trifft sonst den Kommentar, der
 * die Abwesenheit erklaert. Dann waere jede gute Begruendung ein Fehlalarm,
 * und das Mittel dagegen waere, keine zu schreiben.
 */
function nurCode(text) {
  return text.split("\n").filter((z) => {
    const t = z.trim()
    return t !== "" && !t.startsWith("//") && !t.startsWith("*")
      && !t.startsWith("/*")
  }).join("\n")
}

const code = nurCode(quelle)

/*
 * Eine Funktion aus der Datei schneiden.
 *
 * Vom `function <name>(` bis zur ersten Zeile, die nur `}` enthaelt, also bis
 * zur schliessenden Klammer auf Spalte 0. Das traegt, weil die Datei
 * Funktionen auf oberster Ebene einrueckungsfrei schliesst; eine Funktion
 * innerhalb einer Klasse waere so nicht schneidbar, und keine der beiden
 * liegt dort.
 */
function schneide(name) {
  let anfang = quelle.indexOf(`function ${name}(`)
  if (anfang < 0) return null
  // DAS `async` GEHOERT MIT, und der erste Lauf dieses Standes hat genau
  // daran abgebrochen: `new Function` bekam einen Rumpf mit `await` in einer
  // Funktion ohne `async` und warf einen SyntaxError. Ein Schnitt, der ein
  // Schluesselwort vor dem Namen vergisst, liefert gueltig aussehenden Code,
  // der nicht laeuft.
  if (quelle.slice(Math.max(0, anfang - 6), anfang) === "async ") anfang -= 6
  const ende = quelle.indexOf("\n}", anfang)
  if (ende < 0) return null
  return quelle.slice(anfang, ende + 2)
}

// ═══════════════════════════════════════════════════════════ Lage A ════════
//
// DER SCHALTER. Er traegt die Ruecknahme ohne Auslieferung, und seine Vorgabe
// entscheidet, was ein Kunde heute bekommt.

console.log("\nLage A, der Schalter und sein Anhang")

const schalterZeile = /const BILDFORM_ADRESSE_AN = (true|false)/.exec(code)

pruefe("A1 der Schalter steht im Quelltext",
  schalterZeile !== null,
  schalterZeile === null
    ? "NICHT GEFUNDEN. Null heisst, die Suche trifft nicht mehr, nicht dass "
      + "kein Schalter da ist"
    : `const BILDFORM_ADRESSE_AN = ${schalterZeile[1]}`)

/*
 * DIE VORGABE IST `false`, und dieser Satz ist ABSICHTLICH scharf.
 *
 * Er wird rot, sobald jemand sie auf `true` stellt, und das ist gewollt: das
 * Umstellen ist eine Betreiberentscheidung nach einem Deploy und einem
 * gesehenen Lauf, nicht eine Zeile im Vorbeigehen. Wer sie stellt, aendert
 * diesen Satz mit und schreibt den Grund dazu.
 */
pruefe("A2 die Vorgabe ist AUS, bis der Betreiber sie stellt",
  schalterZeile !== null && schalterZeile[1] === "false",
  schalterZeile === null ? "kein Schalter gefunden"
    : schalterZeile[1] === "false"
      ? "AUS. Der Installer verhaelt sich Zeichen fuer Zeichen wie vorher"
      : "AN. Wenn das gewollt ist, gehoert dieser Satz mitgeaendert und der "
        + "Grund in die Zeile daneben")

const anhang = schneide("_beneosBildformAnhang")
pruefe("A3 der Anhang steht an EINER Stelle",
  anhang !== null && /BILDFORM_ADRESSE_AN \? "&bildform=adresse"/.test(anhang),
  anhang === null ? "NICHT GESCHNITTEN"
    : "_beneosBildformAnhang() liest den Schalter und gibt den Parameter")

// Die Zahl der Stellen, die den Parameter wortwoertlich nennen. Genau eine:
// der Anhang selbst. Stuende er an den drei Rufstellen, waere ein Umschalten
// an zwei Stellen moeglich, und genau so ist die harte Variantennummer Eins
// auf der Serverseite entstanden.
const wortwoertlich = (code.match(/&bildform=adresse/g) || []).length
pruefe("A4 der Parameter steht genau einmal im Quelltext",
  wortwoertlich === 1,
  `${wortwoertlich} Vorkommen. Mehr als eines heisst zwei Stellen fuer eine `
  + "Regel, und eine davon wird beim naechsten Umbau vergessen")

// ═══════════════════════════════════════════════════════════ Lage B ════════

console.log("\nLage B, die drei Anfragen fragen nach der neuen Form")

const RUFE = [
  ["get_token", "tokenKey"],
  ["get_item", "itemKey"],
  ["get_spell", "spellKey"],
]

const ohneAnhang = []
for (const [ruf, schluessel] of RUFE) {
  const m = new RegExp(
    `\\?${ruf}=1[^\\n]*${schluessel}[^\\n]*`).exec(code)
  if (m === null) { ohneAnhang.push(`${ruf} (Zeile nicht gefunden)`); continue }
  if (!m[0].includes("_beneosBildformAnhang()")) ohneAnhang.push(ruf)
}

pruefe("B1 alle drei Installationsanfragen tragen den Anhang",
  ohneAnhang.length === 0,
  ohneAnhang.length === 0
    ? "get_token, get_item und get_spell"
    : `OHNE Anhang: ${ohneAnhang.join(", ")}`)

// GEGENPROBE: findet die Suche die drei Zeilen ueberhaupt? Null Treffer sehen
// von aussen aus wie drei richtige.
const gefundeneRufe = RUFE.filter(([r, k]) =>
  new RegExp(`\\?${r}=1[^\\n]*${k}`).test(code)).length
pruefe("B2 die Suche findet alle drei Anfragezeilen",
  gefundeneRufe === 3,
  `${gefundeneRufe} von 3 Zeilen gefunden`)

// ═══════════════════════════════════════════════════════════ Lage C ════════
//
// DIE ZAHL DER VERBLIEBENEN BASE64-STELLEN. Das ist der Satz, der den
// gefaehrlichsten Fehler dieses Umbaus faengt.

console.log("\nLage C, base64 liegt nur noch an einer Stelle")

const base64Stellen = (code.match(/data:image\/webp;base64,/g) || []).length
pruefe("C1 der base64-Umschlag steht genau einmal",
  base64Stellen === 1,
  `${base64Stellen} Vorkommen. Vor dem Umbau waren es zwoelf; die eine liegt `
  + "im Rueckfall von _beneosBildDatei(). Null hiesse, der Rueckfall ist weg "
  + "und ein alter Server liefert nichts mehr")

// Die Vorpruefungen. KEINE Stelle darf mehr direkt auf `image64` pruefen,
// ausser der Helfer selbst.
const direktePruefung = []
for (const zeile of code.split("\n")) {
  if (!/image64/.test(zeile)) continue
  if (/data:image\/webp;base64,/.test(zeile)) continue
  // Der Helfer darf, er IST die Stelle, die beide Formen kennt.
  if (/eintrag\.image64/.test(zeile)) continue
  direktePruefung.push(zeile.trim().slice(0, 70))
}
pruefe("C2 keine Stelle ausser dem Helfer fragt nach image64",
  direktePruefung.length === 0,
  direktePruefung.length === 0
    ? "alle Vorpruefungen gehen ueber _beneosBildDa()"
    : `${direktePruefung.length} Stelle(n): ${direktePruefung.join(" | ")}`)

// GEGENPROBE zu C2: findet die Suche ueberhaupt Zeilen mit `image64`? Heute
// genau die des Helfers, und die sind ausgenommen. Ohne diesen Satz waere ein
// kaputter Filter von einem leeren Befund nicht zu unterscheiden.
const alleImage64 = code.split("\n")
  .filter((z) => /image64/.test(z)).length
pruefe("C3 die Suche findet die Zeilen des Helfers",
  alleImage64 >= 2,
  `${alleImage64} Zeile(n) mit image64 im Code. Unter zwei heisst, der `
  + "Helfer ist weg oder die Suche trifft nicht mehr")

const aufrufe = (code.match(/_beneosBildDatei\(/g) || []).length
pruefe("C4 zwoelf Schreibstellen plus die Definition rufen den Helfer",
  aufrufe === 13,
  `${aufrufe} Vorkommen von _beneosBildDatei(. Erwartet 13: zwoelf `
  + "Schreibstellen und die Definition. Weniger heisst, eine Stelle baut "
  + "wieder von Hand")

const daAufrufe = (code.match(/_beneosBildDa\(/g) || []).length
pruefe("C5 drei Vorpruefungen plus Definition plus der Helfer rufen _beneosBildDa",
  daAufrufe === 5,
  `${daAufrufe} Vorkommen von _beneosBildDa(. Erwartet 5: drei `
  + "Vorpruefungen, die Definition, und der Riegel in _beneosBildDatei()")

// ═══════════════════════════════════════════════════════════ Lage D ════════
//
// DIE HELFER WIRKLICH GEFAHREN. Das ist der Teil, der nicht am Quelltext
// haengt.

console.log("\nLage D, _beneosBildDa() gefahren")

const sDa = schneide("_beneosBildDa")
const sDatei = schneide("_beneosBildDatei")

if (sDa === null || sDatei === null) {
  console.log("\nAbbruch: eine der zwei Funktionen ist nicht schneidbar.")
  console.log(`  _beneosBildDa:    ${sDa === null ? "FEHLT" : "ok"}`)
  console.log(`  _beneosBildDatei: ${sDatei === null ? "FEHLT" : "ok"}`)
  process.exit(1)
}

// Nachbau von `File` und `console.warn`, damit der geschnittene Code laeuft.
const meldungen = []
const umgebung = {
  File: class {
    constructor(teile, name, opt) {
      this.teile = teile
      this.name = name
      this.type = opt?.type
      this.size = teile[0]?.size ?? 0
    }
  },
  console: { warn: (...a) => meldungen.push(a.map(String).join(" ")) },
  fetch: null,
}

// eslint-disable-next-line no-new-func
const bauen = new Function("File", "console", "fetch",
  `${sDa}\n${sDatei}\nreturn { _beneosBildDa, _beneosBildDatei }`)

function mitFetch(f) {
  return bauen(umgebung.File, umgebung.console, f)
}

const { _beneosBildDa } = mitFetch(async () => {
  throw new Error("in Lage D nicht gerufen")
})

const DA_FAELLE = [
  [null, false, "null"],
  [undefined, false, "undefined"],
  ["adresse", false, "eine Zeichenkette ist kein Eintrag"],
  [{}, false, "leerer Eintrag"],
  [{ filename: "x.webp" }, false, "Name ohne Inhalt"],
  [{ image64: "AAA" }, false, "Bytes ohne Namen"],
  [{ url: "https://x/y" }, false, "Adresse ohne Namen"],
  [{ filename: "x.webp", image64: "AAA" }, true, "alte Form"],
  [{ filename: "x.webp", url: "https://x/y" }, true, "neue Form"],
  [{ filename: "x.webp", image64: null, url: "https://x/y" }, true,
    "neue Form, image64 ausdruecklich null"],
  [{ filename: "x.webp", image64: "", url: "" }, false,
    "beide Formen leer, das ist die fehlende Datei"],
  [{ filename: "", image64: "AAA" }, false, "leerer Name"],
  [{ filename: "x.webp", image64: 123 }, false, "Bytes als Zahl"],
  [{ filename: "x.webp", url: 123 }, false, "Adresse als Zahl"],
]

const daFalsch = []
for (const [eingabe, soll, was] of DA_FAELLE) {
  const ist = _beneosBildDa(eingabe)
  if (ist !== soll) daFalsch.push(`${was}: soll ${soll}, ist ${ist}`)
}
pruefe(`D1 ${DA_FAELLE.length} Faelle der Vorpruefung`,
  daFalsch.length === 0,
  daFalsch.length === 0
    ? `${DA_FAELLE.length} Faelle, alle wie erwartet`
    : daFalsch.join(" | "))

/*
 * DER WICHTIGSTE EINZELFALL, und er steht eigens da, damit er beim Lesen
 * nicht in der Liste verschwindet: die NEUE Form mit `image64: null` muss
 * `true` geben. Gaebe sie `false`, uebersprungen alle drei Vorpruefungen jede
 * Datei, und der Installer liefe leer durch, ohne eine Zeile zu meckern.
 */
pruefe("D2 die neue Form mit image64=null gilt als vorhanden",
  _beneosBildDa({ filename: "a-1-top.webp", image64: null,
    url: "https://beneos.cloud/index.php?a=cloud-download&token=xy",
    bytes: 4711 }) === true,
  "sonst ueberspringt der Installer im Adressbetrieb JEDE Datei, "
  + "und zwar stillschweigend")

// ═══════════════════════════════════════════════════════════ Lage E ════════

console.log("\nLage E, _beneosBildDatei() gefahren")

function blobMit(n) {
  return { size: n, _blob: true }
}

async function hole(eintrag, antwortgeber) {
  meldungen.length = 0
  const { _beneosBildDatei } = mitFetch(antwortgeber)
  return await _beneosBildDatei(eintrag, "Pruefstand")
}

const ADR = {
  filename: "a-1-top.webp",
  image64: null,
  url: "https://beneos.cloud/index.php?a=cloud-download&token=xy",
  bytes: 1234,
}

// E1: die Adresse wird geholt, nicht das base64.
let gerufen = []
let datei = await hole(ADR, async (u) => {
  gerufen.push(u)
  return { ok: true, status: 200, blob: async () => blobMit(1234) }
})
pruefe("E1 die neue Form holt die Adresse",
  datei !== null && datei.name === "a-1-top.webp"
    && gerufen.length === 1 && gerufen[0] === ADR.url,
  datei === null ? "KEINE Datei zurueck"
    : `${gerufen.length} Abruf(e), Ziel ${gerufen[0]}`)

// E2: die Adresse hat Vorrang, auch wenn base64 dabei steht.
gerufen = []
datei = await hole({ ...ADR, image64: "QUFB" }, async (u) => {
  gerufen.push(u)
  return { ok: true, status: 200, blob: async () => blobMit(1234) }
})
pruefe("E2 die Adresse hat Vorrang vor mitgeschicktem base64",
  gerufen.length === 1 && gerufen[0] === ADR.url,
  gerufen.length === 0 ? "KEIN Abruf, also wurde base64 genommen"
    : `Ziel ${gerufen[0]}`)

// E3: die alte Form geht weiter, und zwar ueber den base64-Umschlag.
gerufen = []
datei = await hole({ filename: "a-1-top.webp", image64: "QUFB" },
  async (u) => {
    gerufen.push(u)
    return { ok: true, status: 200, blob: async () => blobMit(3) }
  })
pruefe("E3 die alte Form geht weiter",
  datei !== null && gerufen.length === 1
    && gerufen[0].startsWith("data:image/webp;base64,"),
  datei === null ? "KEINE Datei zurueck"
    : `Ziel ${String(gerufen[0]).slice(0, 32)}`)

// E4: die Bytezahl wird gegengeprueft.
gerufen = []
datei = await hole(ADR, async (u) => {
  gerufen.push(u)
  return { ok: true, status: 200, blob: async () => blobMit(600) }
})
pruefe("E4 eine zu kurze Datei wird abgewiesen",
  datei === null,
  datei === null
    ? `${gerufen.length} Versuch(e), danach null. Eine halbe WebP landet `
      + "nicht auf der Platte"
    : "DIE KURZE DATEI WURDE GENOMMEN")

pruefe("E4b und sie wird zweimal versucht",
  gerufen.length === 2,
  `${gerufen.length} Versuch(e). Eine abgebrochene Uebertragung ist der `
  + "haeufigste Fall, und ein zweiter Ruf kostet nichts")

pruefe("E4c die Meldung nennt beide Zahlen",
  meldungen.some((m) => m.includes("600") && m.includes("1234")),
  meldungen.length === 0 ? "KEINE Meldung"
    : meldungen[0].slice(0, 80))

// E5: 403 wird NICHT wiederholt.
gerufen = []
datei = await hole(ADR, async (u) => {
  gerufen.push(u)
  return { ok: false, status: 403, blob: async () => blobMit(0) }
})
pruefe("E5 ein 403 wird nicht wiederholt",
  datei === null && gerufen.length === 1,
  `${gerufen.length} Versuch(e). Das Zeichen ist abgelaufen oder der `
  + "Anspruch ist weg, und ein zweiter Ruf gibt dieselbe Antwort")

// E6: 404 ebenso.
gerufen = []
datei = await hole(ADR, async (u) => {
  gerufen.push(u)
  return { ok: false, status: 404, blob: async () => blobMit(0) }
})
pruefe("E6 ein 404 wird nicht wiederholt",
  datei === null && gerufen.length === 1,
  `${gerufen.length} Versuch(e)`)

// E7: 500 WIRD wiederholt, und der zweite Versuch gilt.
gerufen = []
datei = await hole(ADR, async (u) => {
  gerufen.push(u)
  if (gerufen.length === 1) {
    return { ok: false, status: 503, blob: async () => blobMit(0) }
  }
  return { ok: true, status: 200, blob: async () => blobMit(1234) }
})
pruefe("E7 ein 503 wird wiederholt, und der zweite Versuch traegt",
  datei !== null && gerufen.length === 2,
  datei === null
    ? `${gerufen.length} Versuch(e), aber keine Datei. Dann ist der `
      + "Wiederholversuch wirkungslos"
    : `${gerufen.length} Versuche, zweiter erfolgreich. Das ist der `
      + "eigentliche Gewinn: vorher war eine Antwort von 19 MB EIN Versuch")

// E8: ein geworfener Fehler wird ebenso wiederholt.
gerufen = []
datei = await hole(ADR, async (u) => {
  gerufen.push(u)
  if (gerufen.length === 1) throw new Error("Netz weg")
  return { ok: true, status: 200, blob: async () => blobMit(1234) }
})
pruefe("E8 ein geworfener Netzfehler wird wiederholt",
  datei !== null && gerufen.length === 2,
  `${gerufen.length} Versuch(e)`)

// E9: ein leerer Blob ist keine Datei.
gerufen = []
datei = await hole({ ...ADR, bytes: 0 }, async (u) => {
  gerufen.push(u)
  return { ok: true, status: 200, blob: async () => blobMit(0) }
})
pruefe("E9 ein leerer Blob wird nicht zur Datei",
  datei === null,
  datei === null ? "null statt einer Datei von 0 Byte"
    : "EINE LEERE DATEI WURDE GEBAUT")

// E10: ohne Bytezahl wird nicht gegengeprueft, aber genommen.
gerufen = []
const ohneBytes = { filename: "a.webp", image64: null, url: ADR.url }
datei = await hole(ohneBytes, async (u) => {
  gerufen.push(u)
  return { ok: true, status: 200, blob: async () => blobMit(99) }
})
pruefe("E10 ohne Bytezahl in der Antwort wird nicht gegengeprueft",
  datei !== null && gerufen.length === 1,
  datei === null
    ? "ABGEWIESEN. Ein alter Server nennt keine Bytezahl, und dann waere "
      + "jede Datei abgewiesen"
    : "genommen, ein Abruf")

// E11: die fehlende Datei gibt null, ohne einen Abruf.
gerufen = []
datei = await hole({ filename: "a.webp", image64: null, url: null },
  async (u) => { gerufen.push(u); return { ok: true, status: 200,
    blob: async () => blobMit(1) } })
pruefe("E11 eine fehlende Datei loest keinen Abruf aus",
  datei === null && gerufen.length === 0,
  `${gerufen.length} Abruf(e). Der Server sagt mit beiden Feldern leer, dass `
  + "die Datei nicht da ist; ein Abruf darauf waere eine Netzrunde fuer "
  + "nichts")

// ═══════════════════════════════════════════════════════════ Lage F ════════
//
// DIE DRAUFSICHT IST DER EINZIGE SONDERFALL, und sie ist der Grund, warum
// dieser Umbau nicht nur Textersatz ist.

console.log("\nLage F, die Draufsicht darf nicht ueberspringen")

/*
 * WARUM SIE ANDERS IST. Jede andere Schreibstelle darf bei einem Fehlschlag
 * weitergehen: die Datei fehlt dann, und `_beneosValidateInstalledAsset`
 * meldet sie als fehlende Ansicht. Die Draufsicht steuert daneben noch den
 * PROTOTYP: `_beneosTopVerfuegbar` entscheidet, ob `prototypeToken.texture`
 * auf `-top.webp` zeigt. Ein `continue` liesse das Feld `undefined`, und der
 * Prototyp zeigte auf eine Datei, die nicht da ist; das ist der 404-Fall aus
 * M8.3.39, den ein Kunde als Fehlerregen in der Konsole gemeldet hat.
 */
const topBlock = /const topFile = await _beneosBildDatei\([^\n]*\n([\s\S]{0,900}?)topData\._beneosTopVerfuegbar = /
  .exec(code)

pruefe("F1 die Draufsicht holt ihre Datei ueber den Helfer",
  topBlock !== null,
  topBlock === null
    ? "NICHT GEFUNDEN. Entweder baut sie wieder von Hand, oder zwischen "
      + "Abruf und _beneosTopVerfuegbar liegen mehr als 900 Zeichen"
    : "const topFile = await _beneosBildDatei(...), und das Verfuegbarkeitsfeld folgt")

pruefe("F2 zwischen Abruf und Prototypfeld steht kein continue",
  topBlock !== null && !/\bcontinue\b/.test(topBlock[1]),
  topBlock === null ? "Block nicht geschnitten"
    : /\bcontinue\b/.test(topBlock[1])
      ? "EIN continue. Dann bleibt _beneosTopVerfuegbar undefined, und der "
        + "Prototyp zeigt auf eine Datei, die nicht da ist"
      : "kein continue, das Feld wird in jedem Fall gesetzt")

pruefe("F3 der Upload laeuft nur mit einer Datei",
  /topUpload = topFile\s*\n?\s*\?\s*await _beneosSafeUpload/.test(code),
  /topUpload = topFile/.test(code)
    ? "topFile ? await _beneosSafeUpload(...) : null"
    : "KEIN Riegel vor dem Upload. _beneosSafeUpload bekaeme null als Datei")

// GEGENPROBE zu F2: greift die continue-Suche ueberhaupt? Ein Muster, das
// nichts findet, ist von einem sauberen Block nicht zu unterscheiden.
pruefe("F4 die continue-Suche findet ein continue, wenn eines da ist",
  /\bcontinue\b/.test("  if (!file) continue\n  weiter()"),
  "in einem Probetext mit continue gefunden")

// ═══════════════════════════════════════════════════════════ Lage G ════════
//
// DIE GESAMTMENGE. Keine Schreibstelle darf uebersehen worden sein.

console.log("\nLage G, die Gesamtmenge der Schreibstellen")

/*
 * Jede Stelle, die eine Datei hochlaedt, muss sie ueber den Helfer bekommen.
 * Der Satz zaehlt die Uploads und haelt sie gegen die Helferaufrufe.
 *
 * ZWEI UPLOADS SIND AUSGENOMMEN und stehen hier namentlich, denn eine
 * Ausnahme ohne Namen ist eine Erlaubnis:
 *
 *   - der Upload im Kartenpaketzweig, der eine JSON-Datei schreibt
 *   - der Upload des Installers fuer Dateien aus einem ZIP
 *
 * Beide tragen keine Bilddatei aus einer Cloud-Antwort.
 */
const uploads = (code.match(/_beneosSafeUpload\(/g) || []).length
pruefe("G1 die Suche findet die Uploadstellen",
  uploads >= 12,
  `${uploads} Aufruf(e) von _beneosSafeUpload(. Unter zwoelf heisst, die `
  + "Suche trifft nicht mehr")

// Jede Zeile mit `new File(` muss entweder im Helfer stehen oder eine
// benannte Ausnahme sein. Sonst baut irgendwo wieder jemand von Hand.
const neueDateien = []
for (const zeile of code.split("\n")) {
  if (!/new File\(/.test(zeile)) continue
  neueDateien.push(zeile.trim().slice(0, 72))
}
pruefe("G2 new File() steht nur noch im Helfer und bei Fremddateien",
  neueDateien.length <= 3,
  `${neueDateien.length} Stelle(n) mit new File(:\n       `
  + neueDateien.join("\n       "))

console.log("")
console.log("Der Installer kann Adressen lesen, faellt ohne sie auf base64")
console.log("zurueck, und keine Vorpruefung haengt mehr an den Bytes.")
console.log("NICHT PRUEFBAR: ob ein echter Abruf am Tor die gemeinte Datei")
console.log("liefert, und ob ein Upload in Foundry ankommt. Das erste braucht")
console.log("cluster031, das zweite ein laufendes Foundry mit Konto.")
console.log("Ebenso nicht: ob zwoelf kleine Abrufe auf dem Weg aus")
console.log("`OP-PRJ-190` wirklich besser tragen als eine grosse Antwort. Das")
console.log("ist gerechnet und am Kundenanschluss nicht gemessen, und dafuer")
console.log("gibt es den Schalter.")
console.log("")
console.log(`Ergebnis: ${gruen} gehalten, ${rot} Befund(e).`)
process.exit(rot === 0 ? 0 : 1)
