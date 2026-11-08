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
// WAS ER NICHT FAENGT, und das ist gemessen und nicht geschaetzt. 19
// Sabotagen gefahren, 16 gefangen. Die drei, die durchkommen, sind alle
// dieselbe Klasse: eine Aenderung AN DIESEM STAND, die seine eigene Pruefung
// entwertet. Die Schranke im Rumpf auf null, die Bedingung des
// Gegenzahlsatzes auf `true`, und die Gegenzahlfunktion so geaendert, dass
// sie denselben Zaehler zurueckgibt statt roh nachzuzaehlen.
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
const funktionQuelle = extractMethod(sucheText, "schwellenReihenfolge", { minZeilen: 20, maxZeilen: 60 })
const regelQuelle = `${schwelleQuelle}\n${funktionQuelle.replace(/^export\s+/, "")}`

const schwellenReihenfolge = new Function(`${regelQuelle}\nreturn schwellenReihenfolge`)()

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
    "ordne(l) { return this.#orderDropdownList(l) }"
  ],
  `${regelQuelle}\nconst game = {}`
)
const orderDropdownList = (l) => new fensterProbe().ordne(l)

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
