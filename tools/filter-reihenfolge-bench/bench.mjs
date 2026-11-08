// Prueft, dass die beiden Schwellenlisten des Suchfensters in ihrer
// Sachreihenfolge stehen und nicht in der ihrer Beschriftung.
//
// WARUM ES DIESEN STAND GIBT, OP-PRJ-200. Zwei Filterlisten tragen Schluessel
// aus einem Vergleichszeichen und einer Zahl: die Gittergroesse (`<150` bis
// `>2000`) und der Preis (`<100` bis `>15000`). Nach der Beschriftung
// sortiert stand die Preisleiste als
//
//   < 1000g | < 100g | < 15.000g | < 5000g | > 15.000g | Any
//
// Der Kunde las eine Leiter, die keine ist, und `Any` stand am Ende. Der
// Zweig, der das haette richten sollen, war seit seiner Entstehung
// unerreichbar: er pruefte `tab[0].key[0]`, und das erste Element ist immer
// `any`. Dazu stand er als Rumpfcode ausserhalb einer Vergleichsfunktion und
// benutzte zwei undefinierte Namen; ESLint meldete dafuer zwei `no-undef`.
//
// ZWEI STELLEN, UND DAS IST DER GRUND FUER DIESEN STAND. Die Messung am
// 08.11.2026 hat gezeigt, dass die beiden Listen NICHT gleich betroffen sind:
//
//   - `price` geht nur durch `sortProperties` und kommt im neuen Fenster
//     ueber `...context` unveraendert an. Dort war der Fehler sichtbar.
//   - `gridList` wird im neuen Fenster von `#orderDropdownList` NEU geordnet,
//     und zwar wieder alphabetisch nach Beschriftung. Eine Reparatur allein
//     in `sortProperties` haette dort nichts geheilt, weil die zweite Stelle
//     sie ueberschreibt.
//
// Deshalb messen beide Haelften dieses Standes verschiedene Dateien, und
// deshalb sind es nicht zwei Schreibweisen derselben Sache.
//
// WAS ER AM ECHTEN QUELLTEXT MISST und nicht an einer Abschrift: die
// Funktion, beide Sortierstellen, die beiden festen Listen und die Frage,
// welche Liste wirklich durch welche Stelle laeuft. Eine Abschrift wuerde
// gruen bleiben, wenn jemand die Rufstelle entfernt.
//
// ER MISST SEIT DEM 08.11.2026 ZWEI WEITERE SACHEN, OP-PRJ-202, und beide
// liegen in derselben Funktion, nur eine Zeile auseinander:
//
//   - `sortProperties` entschied die Zahlensortierung an `Number(tab[0].key)`,
//     und `Number("0")` ist falsch. Eine Liste, die mit `"0"` beginnt, fiel
//     deshalb in die Textsortierung: `0, 1, 2, 5, 10, 11, 12` stand als
//     `0 | 1 | 10 | 11 | 12 | 2 | 5`. Einstellige Stufen fielen nicht auf.
//   - `toTable()` bekam mit `this.itemRarity` ein ARRAY und las darin die
//     Indizes. Aus sechs Eintraegen wurden zwoelf, und `#buildOrderedRarity`
//     im neuen Fenster traf dadurch IMMER alle sechs Stufen, auch bei leerem
//     Katalog, einschliesslich `Artifact`, das in der festen Liste gar nicht
//     stand. Der Filter zeigte also die Laenge des Arrays und nicht den
//     Bestand.
//
// WAS ER NICHT FAENGT, und das ist gemessen und nicht geschaetzt. 35
// Sabotagen gefahren, 31 gefangen. Die vier, die durchkommen, sind alle
// dieselbe Klasse: eine Aenderung AN DIESEM STAND, die seine eigene Pruefung
// entwertet. Die Schranke im Rumpf auf null, die Bedingung des
// Gegenzahlsatzes auf `true`, die Gegenzahlfunktion so geaendert, dass sie
// denselben Zaehler zurueckgibt statt roh nachzuzaehlen, und der Vergleich
// der Leiter gegen sich selbst.
//
// Das ist nicht behoben, sondern benannt, und zwar mit Grund: eine Pruefung,
// die ihre eigene Entwertung fangen soll, braucht eine Pruefung ihrer
// Pruefung, und die waere auf demselben Weg entwertbar. Der Schutz dagegen
// liegt ausserhalb dieser Datei, naemlich darin, dass eine Aenderung an
// einem Pruefstand im Diff gelesen wird. Wer hier etwas lockert, soll die
// Zeile kennen, die er lockert.
//
// Aufruf:
//   node bench.mjs
//
// Kein Foundry und kein Netz noetig.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { extractMethod, extractConst, buildProbe } from "../lib/extract-method.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const SUCHE = join(HERE, "..", "..", "scripts", "beneos_search_engine.js")
const FENSTER = join(HERE, "..", "..", "scripts", "cloud-v2", "cloud-window-v2.mjs")

const sucheText = readFileSync(SUCHE, "utf8")
const fensterText = readFileSync(FENSTER, "utf8")

/* ---------------------------------------------------------- Mini-Pruefstand */

let bestanden = 0
let gescheitert = 0
let geleseneEintraege = 0
let quellEintraege = 0
let geleseneListen = 0

function ok(name, bedingung, detail = "") {
  if (bedingung) {
    console.log(`  ok   ${name}`)
    bestanden++
  } else {
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`)
    gescheitert++
  }
}

/* ------------------------------------------- die Funktion aus dem Quelltext */

const schwelleQuelle = extractConst(sucheText, "BENEOS_SCHWELLE")
const zahlQuelle = extractConst(sucheText, "BENEOS_ZAHL")
const funktionQuelle = extractMethod(sucheText, "schwellenReihenfolge", { minZeilen: 20, maxZeilen: 60 })
const zahlFunktion = extractMethod(sucheText, "zahlenReihenfolge", { minZeilen: 15, maxZeilen: 50 })
const regelQuelle = [
  schwelleQuelle,
  zahlQuelle,
  funktionQuelle.replace(/^export\s+/, ""),
  zahlFunktion.replace(/^export\s+/, "")
].join("\n")

const schwellenReihenfolge = new Function(`${regelQuelle}\nreturn schwellenReihenfolge`)()
const zahlenReihenfolge = new Function(`${regelQuelle}\nreturn zahlenReihenfolge`)()

/* -------------------------------------- die beiden Sortierstellen, echt */

/*
 * `sortProperties` steckt in einer Klasse, die Foundry-Globale hereinzieht,
 * und `#orderDropdownList` ist privat. Beide werden deshalb geschnitten und
 * in eine eigene Klasse gestellt. Gemessen wird der ECHTE Rumpf; eine
 * Verschiebung im Modul laesst den Schnitt abbrechen statt still die falsche
 * Stelle zu messen.
 */
const sortProbe = buildProbe(
  [extractMethod(sucheText, "sortProperties", { minZeilen: 20, maxZeilen: 50 })],
  regelQuelle
)
const sortProperties = (tab) => sortProbe.sortProperties(tab)

const fensterProbe = buildProbe(
  [
    extractMethod(fensterText, "#orderDropdownList", { minZeilen: 15, maxZeilen: 50 }),
    extractMethod(fensterText, "#capitalize", { minZeilen: 1, maxZeilen: 3 }),
    extractMethod(fensterText, "#buildOrderedRarity", { minZeilen: 20, maxZeilen: 50 }),
    "ordne(l) { return this.#orderDropdownList(l) }",
    "leiter(l) { return this.#buildOrderedRarity(l) }"
  ],
  `${regelQuelle}\nconst game = {}`
)
const orderDropdownList = (l) => new fensterProbe().ordne(l)
const buildOrderedRarity = (l) => new fensterProbe().leiter(l)

/*
 * `toTable` ruft die Uebersetzung fuer `Any`, also bekommt der Schnitt ein
 * Stellvertreter-`game`. Gemessen wird der echte Rumpf samt der neuen
 * Durchgabe fuer Listen, die schon Tabellenform haben.
 */
const tableProbe = buildProbe(
  [
    /*
     * `BeneosDatabaseHolder` heisst in der Probe `Probe`, und der Name wird
     * im Schnitt umgesetzt statt im Vorlauf gestellt: eine Stellvertretung im
     * Vorlauf kann die Klasse nicht sehen, sie entsteht erst danach.
     */
    extractMethod(sucheText, "toTable", { minZeilen: 20, maxZeilen: 60 })
      .split("BeneosDatabaseHolder.").join("Probe."),
    extractMethod(sucheText, "sortProperties", { minZeilen: 20, maxZeilen: 70 })
  ],
  `${regelQuelle}\nconst game = { i18n: { localize: () => "Any" } }`
)
const toTable = (o) => tableProbe.toTable(o)

/* ------------------------------------- die festen Listen aus dem Quelltext */

/**
 * Liest eine der festen Filterlisten aus der Quelle und ersetzt den
 * Uebersetzungsruf fuer `Any` durch den englischen Text.
 *
 * Am Quelltext und nicht abgeschrieben: eine Abschrift veraltet lautlos,
 * sobald jemand eine Preisstufe einzieht, und dann prueft der Stand seine
 * eigene Erinnerung statt das Produkt.
 */
function listeAusQuelle(name) {
  const i = sucheText.indexOf(`this.${name} = [`)
  if (i < 0) throw new Error(`Liste ${name} nicht in der Quelle gefunden`)
  let tiefe = 0
  let j = sucheText.indexOf("[", i)
  const von = j
  for (; j < sucheText.length; j++) {
    if (sucheText[j] === "[") tiefe++
    else if (sucheText[j] === "]") {
      tiefe--
      if (tiefe === 0) break
    }
  }
  if (tiefe !== 0) throw new Error(`Liste ${name} ist nicht geschlossen`)
  const roh = sucheText.slice(von, j + 1)
  const liste = new Function(`const game = { i18n: { localize: () => "Any" } }\nreturn ${roh}`)()
  if (!Array.isArray(liste) || liste.length < 3) {
    throw new Error(`Liste ${name} hat ${liste && liste.length} Eintraege, das ist zu wenig`)
  }
  geleseneEintraege += liste.length
  quellEintraege += liste.length
  geleseneListen++
  return liste
}

/**
 * Zaehlt dieselben Eintraege ein zweites Mal, und zwar roh am Quelltext statt
 * ueber die ausgefuehrte Liste.
 *
 * WARUM ZWEIMAL. Ein Sammler an der falschen Stelle ist von einem arbeitenden
 * nicht zu unterscheiden. Eine Sabotage, die `listeAusQuelle` durch eine
 * Abschrift ersetzt, laesst den ersten Zaehler ruhig weiterlaufen und den
 * Stand gruen bleiben, obwohl er dann seine eigene Erinnerung prueft. Diese
 * Gegenzahl entsteht an einer ANDEREN Stelle und aus einer anderen Quelle,
 * deshalb faellt der Vergleich auf.
 */
function gegenzahlAusQuelle(namen) {
  let summe = 0
  for (const name of namen) {
    const i = sucheText.indexOf(`this.${name} = [`)
    if (i < 0) throw new Error(`Liste ${name} nicht in der Quelle gefunden`)
    const ende = sucheText.indexOf("]", sucheText.indexOf("[", i))
    const roh = sucheText.slice(i, sucheText.indexOf("]", ende) + 1)
    const treffer = roh.match(/\{\s*key:/g)
    if (!treffer) throw new Error(`Liste ${name} hat keine Eintraege im Quelltext`)
    summe += treffer.length
  }
  return summe
}

const LISTEN = ["gridList", "itemPrice", "crList", "itemRarity"]
const gridList = listeAusQuelle("gridList")
const itemPrice = listeAusQuelle("itemPrice")
const crList = listeAusQuelle("crList")
const itemRarity = listeAusQuelle("itemRarity")
const gegenzahl = gegenzahlAusQuelle(LISTEN)

const z = (l) => l.map((r) => r.value).join(" | ")

/**
 * Wirft die Kommentarzeilen aus einer Quelle, damit eine Quelltextprobe nicht
 * ihren eigenen Erklaertext findet.
 *
 * WARUM DAS NOETIG IST, gemessen am 08.11.2026. Der Satz "die Seltenheit wird
 * nicht mehr in das Array hineingemischt" fiel durch, obwohl die Zeile
 * entfernt war: der Kommentar an ihrer Stelle NENNT sie, und der Anker traf
 * den Kommentar. Eine Probe, die auf eine Abwesenheit zielt, muss den Text
 * ausnehmen, der die Abwesenheit erklaert. Sonst ist jede gute Begruendung
 * ein Fehlalarm, und das Mittel dagegen waere, keine zu schreiben.
 */
function nurCode(text) {
  return text
    .split("\n")
    .filter((z1) => {
      const t = z1.trim()
      return t !== "" && !t.startsWith("//") && !t.startsWith("*")
        && !t.startsWith("/*")
    })
    .join("\n")
}

const sucheCode = nurCode(sucheText)

/* ------------------------------------------------------- Die Sache selbst */

console.log("Die beiden Schwellenlisten stehen in ihrer Sachreihenfolge")

{
  /*
   * Der Nachweis, den `OP-PRJ-200` woertlich verlangt. `price` geht nur durch
   * `sortProperties`, deshalb wird hier genau diese eine Stelle gemessen.
   */
  const preis = sortProperties(structuredClone(itemPrice))
  ok(`die Preisliste steht als Leiter (${z(preis)})`,
    z(preis) === "Any | < 100g | < 1000g | < 5000g | < 15.000g | > 15.000g",
    "nach Beschriftung sortiert stand < 1000g vor < 100g und Any am Ende")

  ok("und Any steht vorn, nicht am Ende", preis[0].key === "any")
}

{
  /*
   * `gridList` laeuft durch BEIDE Stellen. Gemessen wird die Kette, denn eine
   * Reparatur nur in `sortProperties` waere von der zweiten Stelle
   * ueberschrieben worden.
   */
  const gitter = orderDropdownList(sortProperties(structuredClone(gridList)))
  ok(`die Gitterliste steht als Leiter (${z(gitter)})`,
    z(gitter) === "Any | Tiny | Small | Medium | Big | Very Big",
    "alphabetisch stand Big vor Medium vor Small vor Tiny")

  ok("und Big steht vor Very Big, obwohl beide 2000 tragen",
    gitter.findIndex((r) => r.key === "<2000") < gitter.findIndex((r) => r.key === ">2000"),
    "bei gleicher Zahl muss < vor > stehen")
}

{
  /*
   * Die zweite Stelle allein. Faellt dieser Satz, ordnet das neue Fenster
   * wieder nach Beschriftung, und der Fehler ist zurueck, obwohl
   * `sortProperties` heil ist.
   */
  const nurFenster = orderDropdownList(structuredClone(gridList))
  ok(`das neue Fenster ordnet auch ohne die erste Stelle richtig (${z(nurFenster)})`,
    z(nurFenster) === "Any | Tiny | Small | Medium | Big | Very Big")
}

/* ----------------------------------------- Die Gegenproben, die treffen muessen */

console.log("\nGegenproben: was sich NICHT aendern darf")

{
  /*
   * Die Bedingung aus dem Ticket. Greift die neue Regel auf eine Liste, die
   * keine Schwellenliste ist, waere sie keine Reparatur, sondern ein
   * zweiter Fehler.
   */
  const zahlen = [{ key: "any", value: "Any" }, { key: "1", value: "1" },
  { key: "10", value: "10" }, { key: "2", value: "2" }]
  const text = [{ key: "any", value: "Any" }, { key: "zebra", value: "Zebra" },
  { key: "apfel", value: "Apfel" }, { key: "mango", value: "Mango" }]
  geleseneEintraege += zahlen.length + text.length

  ok("eine Liste mit reinen Zahlenschluesseln laesst die Regel liegen",
    schwellenReihenfolge(zahlen) === null)
  ok("eine Liste mit reinen Textschluesseln laesst die Regel liegen",
    schwellenReihenfolge(text) === null)
  ok(`reiner Text sortiert weiter alphabetisch (${z(sortProperties(structuredClone(text)))})`,
    z(sortProperties(structuredClone(text))) === "Any | Apfel | Mango | Zebra")
  ok(`und im neuen Fenster ebenso (${z(orderDropdownList(structuredClone(text)))})`,
    z(orderDropdownList(structuredClone(text))) === "Any | Apfel | Mango | Zebra")
}

{
  /*
   * Eine halb erkannte Liste waere schlimmer als eine unsortierte, denn sie
   * saehe geordnet aus. Ein einziger Schluessel ohne die Form muss die ganze
   * Liste durchfallen lassen.
   */
  const halb = [{ key: "any", value: "Any" }, { key: "<150", value: "Tiny" },
  { key: "gross", value: "Gross" }]
  geleseneEintraege += halb.length
  ok("eine Liste mit einem Schluessel ohne die Form faellt GANZ durch",
    schwellenReihenfolge(halb) === null,
    "sonst stuende ein Teil geordnet und der Rest zufaellig")
}

{
  /*
   * Was NACH dem Vergleichszeichen steht, muss eine Zahl sein. Eine zu weite
   * Form nimmt `<abc` an, `Number("abc")` ist NaN, und jeder Vergleich mit
   * NaN gibt 0: die Liste bliebe in ihrer Eingangsreihenfolge stehen und
   * saehe damit geordnet aus, obwohl nichts geordnet wurde. Das ist die
   * Sabotage, die beim ersten Lauf dieses Standes durchkam.
   */
  const faelle = [
    ["<abc", "Zeichen ohne Zahl"],
    ["<", "Zeichen ohne alles"],
    [">", "Zeichen ohne alles"],
    ["< 100", "Leerzeichen zwischen Zeichen und Zahl"],
    ["<1e5", "Exponentenform"],
    ["<-5", "Vorzeichen"],
    ["<<100", "doppeltes Zeichen"]
  ]
  geleseneEintraege += faelle.length
  for (const [schluessel, warum] of faelle) {
    const liste = [{ key: "any", value: "Any" }, { key: "<10", value: "Zehn" },
    { key: schluessel, value: "Unfug" }]
    ok(`\`${schluessel}\` ist keine Schwelle (${warum})`,
      schwellenReihenfolge(liste) === null,
      "eine zu weite Form rechnet mit NaN und laesst die Liste unsortiert, aber geordnet aussehend")
  }
}

{
  /*
   * `crList` und `itemRarity` sind die beiden Listen, die aussehen, als
   * koennten sie betroffen sein, und es nicht sind. `crList` traegt
   * Kommaspannen (`0,4`) und geht ueberdies gar nicht durch
   * `sortProperties`. `itemRarity` traegt Leerzeichen-Praefixe
   * (`"    Common"`), mit denen jemand die Textsortierung schon per Hand
   * umgangen hat.
   */
  ok(`die Herausforderungsliste bleibt unberuehrt (${crList.length} Stufen)`,
    schwellenReihenfolge(crList) === null)
  ok(`die Seltenheitsliste bleibt unberuehrt (${itemRarity.length} Stufen)`,
    schwellenReihenfolge(itemRarity) === null)

  ok("und die Herausforderungsliste geht gar nicht durch sortProperties",
    /crList:\s*structuredClone\(this\.crList\)/.test(sucheText),
    "laeuft sie kuenftig doch durch, braucht dieser Stand einen Satz dazu")
}

/* ------------------------------ Zahlenlisten, OP-PRJ-202 ------------------ */

console.log("\nZahlenlisten sortieren numerisch, auch mit einer Null darin")

{
  /*
   * Der Vorgaenger entschied die Sortierart an `Number(tab[0].key)`, und
   * `Number("0")` ist falsch. Eine Liste, die mit `"0"` beginnt, fiel deshalb
   * in die Textsortierung. Einstellige Stufen fielen nicht auf, die erste
   * zweistellige macht es sichtbar.
   */
  const alsObjekt = (schluessel) => {
    const o = {}
    for (const k of schluessel) o[k] = 1
    geleseneEintraege += schluessel.length
    return o
  }

  const mitNull = toTable(alsObjekt(["0", "1", "2", "5", "10", "11", "12"]))
  ok(`eine Zahlenliste mit Null und zweistelligen Werten (${z(mitNull)})`,
    z(mitNull) === "Any | 0 | 1 | 2 | 5 | 10 | 11 | 12",
    "vorher stand sie als Any | 0 | 1 | 10 | 11 | 12 | 2 | 5")

  const ohneNull = toTable(alsObjekt(["1", "2", "5", "10", "11"]))
  ok(`eine Zahlenliste ohne Null bleibt unveraendert (${z(ohneNull)})`,
    z(ohneNull) === "Any | 1 | 2 | 5 | 10 | 11",
    "sie war schon richtig, denn Number(\"1\") ist wahr")

  const stufen = toTable(alsObjekt(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]))
  ok("einstellige Stufen bleiben unveraendert",
    z(stufen) === "Any | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9")

  /*
   * Die Herausforderungsstufen stehen im Bestand als Dezimalzahlen. Eine
   * Regel, die nur ganze Zahlen annimmt, waere hier eine Verschlechterung.
   */
  const dezimal = toTable(alsObjekt(["0.125", "0.25", "0.5", "1", "2", "10"]))
  ok(`Dezimalzahlen sortieren numerisch (${z(dezimal)})`,
    z(dezimal) === "Any | 0.125 | 0.25 | 0.5 | 1 | 2 | 10")

  ok("eine Liste mit einem Textschluessel darin ist keine Zahlenliste",
    zahlenReihenfolge([{ key: "any", value: "Any" }, { key: "1", value: "1" },
    { key: "hoch", value: "Hoch" }]) === null,
    "sonst stuende ein Teil geordnet und der Rest zufaellig")

  /*
   * Die Regel direkt, mit `any` darin. Ueber `toTable()` ist das nicht zu
   * messen: dort kommt `any` erst NACH der Sortierung dazu, also bleibt eine
   * Verletzung unsichtbar. Heute traegt keine Zahlenliste ein `any`, aber die
   * beiden Nachbarregeln halten es vorn, und eine Regel, die sich darin
   * unterscheidet, ist eine Falle fuer die naechste Liste.
   */
  const mitAny = zahlenReihenfolge([{ key: "5", value: "5" },
  { key: "any", value: "Any" }, { key: "1", value: "1" }])
  geleseneEintraege += 3
  ok(`die Regel selbst haelt any vorn (${mitAny.map((r) => r.key).join(",")})`,
    mitAny.map((r) => r.key).join(",") === "any,1,5",
    "auch wenn any in der Eingabe in der Mitte steht")
}

/* --------------------- Die Seltenheitsleiter, OP-PRJ-202 ------------------ */

console.log("\nDie Seltenheitsleiter kommt nicht mehr ueber ihre Indizes")

{
  /*
   * `this.itemRarity` ist ein Array von `{ key, value }` und ging an
   * `toTable()`, das ein Objekt erwartet. `for (let key in ...)` las darin die
   * INDIZES, also entstanden die Schluessel `"0"` bis `"5"`. Aus sechs
   * Eintraegen wurden zwoelf, und `#buildOrderedRarity` traf dadurch IMMER
   * alle sechs Stufen, auch bei leerem Katalog.
   *
   * Gemessen wird gegen die echte feste Liste aus dem Quelltext, nicht gegen
   * eine Abschrift.
   */
  const roh = toTable(structuredClone(itemRarity))
  geleseneEintraege += roh.length

  ok(`die Liste hat so viele Eintraege wie Stufen (${roh.length})`,
    roh.length === itemRarity.length,
    `aus ${itemRarity.length} wurden vorher bis zu 12, naemlich Indizes plus Namen`)

  ok("und kein Schluessel ist eine nackte Zahl",
    roh.every((r) => !/^\d+$/.test(String(r.key))),
    `gefunden: ${roh.filter((r) => /^\d+$/.test(String(r.key))).map((r) => r.key).join(",")}`)

  ok("Any steht vorn und nicht zwischen Legendary und Artifact",
    roh[0].key === "any",
    "die Namenssortierung muss any ausnehmen, sonst entscheidet das Praefix")

  /*
   * Der Nachweis, den `OP-PRJ-202` woertlich verlangt: die Anzeige im neuen
   * Fenster bleibt unveraendert. Waere sie anders, waere der Umbau eine
   * sichtbare Aenderung und keine Reparatur.
   */
  const leiter = buildOrderedRarity(roh)
  ok(`das neue Fenster zeigt unveraendert die D&D-Leiter (${z(leiter)})`,
    z(leiter) === "Any | Common | Uncommon | Rare | Very Rare | Legendary | Artifact")

  ok("und `artifact` steht ausdruecklich in der festen Liste",
    itemRarity.some((r) => r.key === "artifact"),
    "es erschien vorher nur, weil der Index 5 den Eimer Artifact traf")

  /*
   * Die Leiter muss AUCH ohne das neue Fenster stimmen. Im Nicht-Item-Modus
   * baut `#buildOrderedRarity` sie nicht, dort kommt genau diese Liste durch.
   * Die Reihenfolge entsteht dann allein aus den Leerzeichen-Praefixen, und
   * die sind ein Trick: wer sie um eins verschiebt, stellt Artifact vor
   * Common, ohne dass der Satz darueber es merkt.
   */
  ok(`die Leiter stimmt auch ohne das neue Fenster (${roh.map((r) => r.key).join(",")})`,
    roh.map((r) => r.key).join(",")
    === "any,common,uncommon,rare,very rare,legendary,artifact",
    "im Nicht-Item-Modus traegt allein das Leerzeichen-Praefix die Reihenfolge")

  /*
   * Das Sammeln der Katalogseltenheiten ist bewusst entfernt. Stand es noch
   * da, haengte es die Werte wieder als Eigenschaften an das Array, und die
   * Indizes waeren zurueck.
   */
  ok("die Seltenheit wird nicht mehr in das Array hineingemischt",
    !/mergeObject\(this\.itemRarity,/.test(sucheCode),
    "gemessen am Quelltext ohne Kommentare, sonst traefe der Anker die Begruendung")

  /*
   * Die Formerkennung muss ENG sein. Ein Array von Zeichenketten hat kein
   * `value`, und `localeCompare` darauf wirft. Heute kommt keines hier an,
   * alle zwanzig anderen Facetten sind Objekte; eine lockere Erkennung macht
   * daraus aber einen Absturz statt der heutigen Indexliste, und das ist die
   * schlechtere Richtung.
   */
  let gestuerzt = false
  let ausZeichenketten = null
  try {
    ausZeichenketten = toTable(["Zebra", "Apfel"])
  } catch (_) {
    gestuerzt = true
  }
  geleseneEintraege += 2
  ok("ein Array von Zeichenketten stuerzt nicht ab",
    !gestuerzt && Array.isArray(ausZeichenketten),
    "die Formerkennung darf nur Eintraege mit key und value durchgeben")

  /*
   * Die Durchgabe darf `any` nicht verlieren. Die heutige einzige
   * Tabellenform traegt es schon, also ist dieser Satz Vorsorge und keine
   * Messung des Bestands. Er steht hier, weil der andere Weg durch dieselbe
   * Funktion es ausdruecklich davorsetzt, und zwei Wege mit zwei Regeln
   * laufen auseinander.
   */
  const ohneAny = toTable([{ key: "zwei", value: "Zwei" }, { key: "eins", value: "Eins" }])
  geleseneEintraege += 2
  ok(`eine Tabellenform ohne any bekommt eines (${z(ohneAny)})`,
    ohneAny.length === 3 && ohneAny[0].key === "any",
    "sonst fehlt der Beliebig-Eintrag genau den Listen, die schon Tabellenform haben")

  ok("die vier offenen Facetten werden weiter gesammelt",
    ["itemOrigin", "itemType", "itemTier", "itemClasses"]
      .every((n) => new RegExp(`mergeObject\\(this\\.${n},`).test(sucheCode)),
    "sie sind offene Mengen und keine geschlossene Leiter")

  /*
   * Die Gegenprobe zur Gegenprobe. Faellt `nurCode` zusammen und gibt die
   * ganze Datei zurueck, bleibt der Satz darueber gruen und die Probe ist
   * blind. Der Vergleich zeigt, dass wirklich etwas weggefallen ist.
   */
  ok(`der Kommentarfilter nimmt wirklich etwas weg (${sucheText.length - sucheCode.length} Zeichen)`,
    sucheCode.length < sucheText.length * 0.95 && sucheCode.length > 10000,
    `voll ${sucheText.length}, ohne Kommentare ${sucheCode.length}`)
}

/* ----------------------------- Die Rufstellen, denn ohne sie wirkt nichts */

console.log("\nDie Rufstellen stehen noch, wo sie wirken muessen")

ok("die Preisliste geht durch sortProperties",
  /price:\s*BeneosDatabaseHolder\.sortProperties\(structuredClone\(this\.itemPrice\)\)/.test(sucheText))

ok("die Gitterliste geht durch sortProperties",
  /gridList:\s*BeneosDatabaseHolder\.sortProperties\(structuredClone\(this\.gridList\)\)/.test(sucheText))

ok("die Gitterliste geht im neuen Fenster durch die zweite Stelle",
  /gridList:\s*orderList\(context\.gridList\)/.test(fensterText))

ok("das neue Fenster holt die Regel aus der einen Quelle",
  /import \{ schwellenReihenfolge \} from "\.\.\/beneos_search_engine\.js"/.test(fensterText),
  "zwei Abschriften derselben Regel driften auseinander")

/*
 * Der kaputte Zweig darf nicht zurueckkommen. Er benutzte `a` und `b`
 * ausserhalb einer Vergleichsfunktion; ESLint meldete dafuer zwei
 * `no-undef`, und das war der einzige Hinweis, den es gab.
 */
ok("der unerreichbare Zweig ist weg",
  !/let a1 = Number\(a\.key\.slice\(1\)\)/.test(sucheText))

ok("und niemand entscheidet die Sortierart mehr am ersten Element",
  !/tab\[0\]\.key\[0\] ==/.test(sucheText),
  "das erste Element ist immer any, deshalb war der Zweig unerreichbar")

/* ------------------------------------- Hat dieser Stand genug gemessen */

console.log("\nDie Probe sagt, wie viel sie gemessen hat")

/*
 * Aus `OP-PRJ-201` gelernt: eine Probe, die nicht sagt, wie viel sie gelesen
 * hat, bleibt gruen, wenn jemand ihre Menge zusammenstreicht. Die Schranke
 * liegt unter dem heutigen Stand, damit eine neue Preisstufe sie nicht
 * aufweckt, und weit ueber null.
 */
ok(`sie hat genug Listeneintraege gelesen (${geleseneEintraege})`,
  geleseneEintraege >= 25,
  "faellt die Zahl, hat jemand die gemessene Menge zusammengestrichen")

/*
 * Die Gegenzahl, und sie ist die eigentliche Sicherung. Die Schranke darueber
 * kann jemand im Rumpf auf null setzen, ohne dass es auffaellt, und genau das
 * kam beim ersten Lauf durch. Dieser Vergleich hat keine handgesetzte Zahl:
 * beide Seiten kommen aus dem Quelltext, aber auf verschiedenen Wegen.
 */
ok(`die vier Produktlisten kamen wirklich aus dem Quelltext (${quellEintraege} gegen ${gegenzahl})`,
  quellEintraege === gegenzahl && geleseneListen === LISTEN.length && gegenzahl >= 20,
  `gelesen ${quellEintraege}, roh gezaehlt ${gegenzahl}, Listen ${geleseneListen} von ${LISTEN.length}`)

ok("und sie hat beide Dateien wirklich gelesen",
  sucheText.length > 20000 && fensterText.length > 100000,
  "ein leerer Quelltext laesst jede Quelltextprobe gruen bleiben")

/* ------------------------------------------------------------------- Bilanz */

console.log(`\n${bestanden} bestanden, ${gescheitert} gescheitert`)
process.exit(gescheitert === 0 ? 0 : 1)
