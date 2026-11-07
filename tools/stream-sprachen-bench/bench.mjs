// Prueft, dass jeder Streaming-Text in allen dreizehn Sprachen vorliegt und
// dass in den Streaming-Vorlagen kein fester Text mehr steht.
//
// Hintergrund, 29.10.2026. `templates/stream/offline-vorrat.hbs` trug deutsche
// Festtexte, in einem Produkt mit dreizehn Sprachdateien: ein Englaender sah
// dort "Die Frist ist abgelaufen." Beim Nachzaehlen kamen zwei weitere Luecken
// heraus, die niemand gemeldet hatte, weil nichts danach sah: drei Schluessel
// fehlten in allen zwoelf nicht-englischen Dateien, und die komplette
// Erklaerung beim ersten Weltstart stand ueberall auf Englisch.
//
// Betreibervorgabe vom selben Tag: zum Release muessen alle Strings in allen
// Sprachen vorliegen. Dieser Stand ist die Messung dazu.
//
// VIER AUSSAGEN, und die vierte kam am 07.11.2026 dazu:
//   1. jeder Schluessel, den eine Streaming-Vorlage ruft, steht in en.json
//   2. jeder BENEOS.Stream.*-Schluessel steht in allen dreizehn Dateien
//   3. keine Streaming-Vorlage traegt einen festen Text
//   4. jeder Streamtext steht in der SCHREIBWEISE seiner Sprache
//
// Die vierte musste dazu, weil die ersten drei nach MENGE fragen und nicht
// nach Schreibweise: 103 gefaltete Werte in neun Sprachen waren vollstaendig
// vorhanden und nicht englisch, also gruen. Siehe `OP-PRJ-199`.
//
// WARUM "GLEICH WIE ENGLISCH" NUR EIN HINWEIS IST UND KEIN FEHLER. Kurze
// Woerter sind in mehreren Sprachen wirklich gleich; "Offline" ist auf
// Franzoesisch "Offline". Ein LANGER englischer Satz in einer deutschen Datei
// ist dagegen nie eine Uebersetzung, sondern eine vergessene. Die Grenze liegt
// deshalb bei der Laenge, nicht bei der Gleichheit.
//
// Aufruf:
//   node bench.mjs          faehrt gegen den aktuellen Stand
//   node bench.mjs --liste  nennt zusaetzlich jede beanstandete Zeile
//
// Kein Foundry und kein Netz noetig.

import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HERE, "..", "..")
const LANG = join(WURZEL, "lang")
const VORLAGEN = join(WURZEL, "templates", "stream")

const zeigeListe = process.argv.includes("--liste")

/* ---------------------------------------------------------- Mini-Pruefstand */

let bestanden = 0
let gescheitert = 0

function ok(name, bedingung, detail = "") {
  if (bedingung) {
    console.log(`  ok   ${name}`)
    bestanden++
  } else {
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`)
    gescheitert++
  }
}

/* ------------------------------------------------------------- Die Quellen */

const dateien = readdirSync(LANG).filter((f) => f.endsWith(".json")).sort()
const sprachen = {}
for (const f of dateien) {
  sprachen[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(LANG, f), "utf8"))
}
const en = sprachen.en
if (!en) throw new Error("lang/en.json fehlt")

const vorlagen = readdirSync(VORLAGEN).filter((f) => f.endsWith(".hbs")).sort()

console.log(`\n${dateien.length} Sprachdateien, ${vorlagen.length} Streaming-Vorlage(n)`)

/* ----------------------------- 1. Vorlagenschluessel stehen in der Leitsprache */

console.log("\nJeder gerufene Schluessel steht in en.json")

const gerufen = new Map()
for (const name of vorlagen) {
  const text = readFileSync(join(VORLAGEN, name), "utf8")
  for (const treffer of text.matchAll(/localize\s+"([A-Za-z0-9._-]+)"/g)) {
    if (!gerufen.has(treffer[1])) gerufen.set(treffer[1], name)
  }
}

const unbekannt = [...gerufen].filter(([k]) => !(k in en))
ok(`alle ${gerufen.size} gerufenen Schluessel sind in en.json bekannt`,
  unbekannt.length === 0,
  unbekannt.map(([k, d]) => `${k} (${d})`).join(", "))

/*
 * Gegenfrage: findet der Leser ueberhaupt etwas? Ein Muster, das nichts
 * trifft, meldet null Unbekannte und sieht aus wie ein sauberer Lauf.
 */
ok("der Leser findet ueberhaupt Schluessel in den Vorlagen", gerufen.size >= 10,
  `gefunden: ${gerufen.size}`)

/* --------------------------------- 2. Jeder Stream-Schluessel in allen Sprachen */

console.log("\nJeder BENEOS.Stream.*-Schluessel steht in allen Sprachen")

const streamKeys = Object.keys(en).filter((k) => k.startsWith("BENEOS.Stream."))
const quotaKeys = Object.keys(en).filter((k) => k.startsWith("BENEOS.Cloud.Bmap.Quota"))
const pflicht = [...streamKeys, ...quotaKeys]

let fehlendGesamt = 0
const fehlendJeSprache = []
for (const [code, d] of Object.entries(sprachen)) {
  const fehlt = pflicht.filter((k) => !(k in d))
  fehlendGesamt += fehlt.length
  if (fehlt.length) fehlendJeSprache.push(`${code}: ${fehlt.length}`)
  if (zeigeListe && fehlt.length) {
    for (const k of fehlt) console.log(`       fehlt  ${code}  ${k}`)
  }
}

ok(`kein Schluessel fehlt (${pflicht.length} Pflichtschluessel mal ${dateien.length} Sprachen)`,
  fehlendGesamt === 0,
  fehlendJeSprache.join(", "))

/*
 * Lange englische Saetze in einer fremden Sprachdatei. Kurze Woerter duerfen
 * gleich sein, lange Saetze nie: eine Uebersetzung, die Zeichen fuer Zeichen
 * dem Englischen gleicht, ist keine.
 */
const LANG_GENUG = 25
let unuebersetztGesamt = 0
const unuebersetztJeSprache = []
for (const [code, d] of Object.entries(sprachen)) {
  if (code === "en") continue
  const gleich = pflicht.filter(
    (k) => k in d && d[k] === en[k] && String(en[k]).length > LANG_GENUG)
  unuebersetztGesamt += gleich.length
  if (gleich.length) unuebersetztJeSprache.push(`${code}: ${gleich.length}`)
  if (zeigeListe && gleich.length) {
    for (const k of gleich) console.log(`       englisch  ${code}  ${k}`)
  }
}

ok(`kein langer Satz steht unuebersetzt auf Englisch (ueber ${LANG_GENUG} Zeichen)`,
  unuebersetztGesamt === 0,
  unuebersetztJeSprache.join(", "))

/* --------------------------------- 3. Keine festen Texte in den Vorlagen */

console.log("\nKeine festen Texte in den Streaming-Vorlagen")

/*
 * Umlaute und scharfes S sind der billigste sichere Fund: sie koennen in einer
 * Vorlage nur aus einem deutschen Festtext stammen, denn jeder sichtbare Text
 * soll durch `localize` kommen. Kommentare zaehlen nicht mit, sie werden nie
 * ausgeliefert.
 */
const deutsch = []
for (const name of vorlagen) {
  const text = readFileSync(join(VORLAGEN, name), "utf8")
  const ohneKommentar = text.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "")
  for (const [i, zeile] of ohneKommentar.split("\n").entries()) {
    if (/[äöüßÄÖÜ]/.test(zeile)) deutsch.push(`${name}:${i + 1}`)
  }
}

ok("keine Vorlage traegt Umlaute ausserhalb von Kommentaren",
  deutsch.length === 0, deutsch.join(", "))

/*
 * Gegenprobe zur Umlautregel: sie findet nur deutsche Festtexte, keine
 * englischen. Deshalb zusaetzlich die Form messen, in der ein Festtext
 * auftritt, naemlich sichtbarer Text direkt zwischen zwei Tags.
 */
const festText = []
for (const name of vorlagen) {
  const text = readFileSync(join(VORLAGEN, name), "utf8")
  const ohneKommentar = text.replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "")
  for (const [i, zeile] of ohneKommentar.split("\n").entries()) {
    // Text zwischen > und <, der Buchstaben traegt und kein Handlebars ist.
    for (const t of zeile.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)) {
      const roh = t[1].trim()
      // "MB" und "GB" sind Einheiten und in jeder Sprache gleich.
      if (!roh || /^(MB|GB|KB)$/.test(roh)) continue
      festText.push(`${name}:${i + 1} "${roh.slice(0, 40)}"`)
    }
  }
}

ok("kein sichtbarer Text steht roh zwischen zwei Tags",
  festText.length === 0, festText.slice(0, 5).join(" | "))

/* ------------------------------- 4. Schreibweise: Diakritika sind nicht weg */

console.log("\nJeder Streamtext steht in der Schreibweise seiner Sprache")

/*
 * Hintergrund, 07.11.2026, `OP-PRJ-199`. Die aelteren Streamtexte trugen die
 * ausgeschriebene Form statt des Sonderzeichens: "waehrend", "Qualitaet" und
 * "fuer" im Deutschen, "pripojeni" im Tschechischen, "polaczenia" im
 * Polnischen, "conexion" im Spanischen, "nao" und "tambem" im
 * Portugiesischen, "instal.lat" statt des katalanischen Mittelpunkts.
 * Gemessen: 103 Werte in neun Sprachen. Der Kunde las im Einfuehrungsdialog
 * Saetze in einer Schreibweise, die seine Sprache nicht benutzt, und das ist
 * die erste Flaeche des Produkts.
 *
 * WARUM DIE DREI ABSCHNITTE DARUEBER DAS NICHT FANGEN: sie fragen nach
 * MENGE, nicht nach Schreibweise. Ein gefalteter deutscher Satz ist
 * vollstaendig vorhanden und nicht englisch, also war er gruen.
 *
 * ZWEI SAETZE, UND DER ZWEITE IST DER WICHTIGE. Der erste haelt eine Liste
 * gefalteter Wortformen dagegen und faengt genau die bekannten. Der zweite
 * haelt die GESAMTMENGE dagegen, naemlich die Zahl der Streamtexte mit
 * mindestens einem Sonderzeichen ihrer Sprache: faellt sie, ist etwas
 * gefaltet worden, auch wenn kein Wort der Liste darin steht. Eine Liste
 * allein waere ein Schutz, der nur das Gestrige kennt.
 *
 * WARUM NICHT "ENTHAELT KEIN SONDERZEICHEN" ALS REGEL: viele Saetze kommen
 * zu Recht ohne aus. Diese Form meldete in `de.json` 37 von 71 langen
 * Saetzen und waere unbrauchbar.
 */

// Formen, die OHNE ihr Sonderzeichen falsch geschrieben sind. Gemessen an
// den 103 Werten, die am 07.11.2026 wirklich gefaltet waren, plus die
// naheliegenden Nachbarformen derselben Woerter. Jede Form wurde gegen den
// Bestand gehalten: "installe", "unico", "zajmuje", "devoravam" und
// "wszystko" stehen ABSICHTLICH nicht in der Liste, sie sind in ihrer
// Sprache ohne Zeichen richtig.
const GEFALTET = {
  de: ["fuer", "ueber\\w*", "waehrend", "waehl\\w*", "qualitaet", "koenn\\w*",
    "laender", "noetig\\w*", "gross\\w*", "moeglich\\w*", "muess\\w*",
    "zurueck\\w*", "naechst\\w*", "oeffn\\w*", "schliess\\w*", "laedt",
    "aender\\w*", "pruef\\w*", "loesch\\w*", "spaeter", "haelt", "faellt",
    "traegt", "haette", "heisst", "verfuegbar", "zusaetzlich", "laeuft",
    "unterstuetz\\w*", "hinzufueg\\w*", "uebrig\\w*", "groesse\\w*",
    "taeglich", "staendig", "naemlich", "ausfuehr\\w*", "schluessel\\w*"],
  ca: ["video", "connexio\\b", "publicacio\\b", "mon\\b", "aixi\\b", "despres",
    "mante\\b", "rapid\\w*", "paisos", "propia", "aqui\\b", "gairebe",
    "unica", "rao\\b", "linia\\b", "debo\\b", "obte\\b", "instal\\.l\\w*",
    "installa\\w*"],
  cs: ["pripoj\\w*", "nacit\\w*", "vcetne", "vase\\b", "vasi\\b", "vaseho",
    "sveta\\b", "svete\\b", "vydani\\b", "uloziste", "lista\\b", "prazdn\\w*",
    "potreb\\w*", "misto\\b", "uctuj\\w*", "temer", "jediny", "duvod",
    "proc\\b", "scenu\\b", "kazdy\\b", "kazde\\b", "kazdeho\\b"],
  es: ["video", "conexion\\b", "instalacion\\b", "despues", "asi\\b",
    "imagenes", "pequeno", "rapido", "paises", "vacia\\b", "unica",
    "linea\\b", "necesitaras", "comian", "habria", "traves", "esten\\b",
    "estes\\b"],
  fr: ["video", "deja\\b", "telecharg\\w*", "utilisee", "etat\\b", "scenes?\\b",
    "megaoctets", "debit\\b", "pres\\b", "repartie", "qualite", "interet",
    "hebergement\\w*", "animees", "devoraient", "bibliotheque", "desormais",
    "etre\\b", "coute\\b"],
  it: ["velocita\\b", "piu\\b", "gia\\b", "cosi\\b", "qualita\\b", "servira\\b",
    "perche", "puo\\b", "sara\\b"],
  pl: ["polaczen\\w*", "swiecie", "swiata", "dzwiek\\w*", "serwerow",
    "pelna\\b", "predkosc", "pamiec", "mozesz", "wlasnym", "zajete",
    "zetony", "ktory\\b", "maly\\b", "lacze", "ciagnie", "stol\\b",
    "jakosci", "wlasne", "zaplacenia", "licza\\b", "pochlania\\w*",
    "miesci\\w*", "moglby", "pomiescic", "stolow", "powod\\b", "jesli\\b",
    "druzyna", "wczesniej", "scene\\b", "srodku", "kazdy\\b", "kazde\\b"],
  "pt-BR": ["video", "nao\\b", "tambem", "voce\\b", "conexao\\b",
    "instalacao\\b", "lancamento\\b", "entao\\b", "proprio\\b", "propria\\b",
    "diarios\\b", "varios\\b", "rapido\\b", "tres\\b", "paises\\b",
    "espaco\\b", "botao\\b", "unica\\b", "razao\\b", "te-la", "ligacao\\b",
    "maxima\\b", "incluidos", "mantem\\b", "existencia", "serio\\b",
    "busca-lo"],
}
GEFALTET["pt-PT"] = GEFALTET["pt-BR"]

// Sonderzeichen je Sprache, fuer die Gesamtmengenprobe darunter. GROSS UND
// KLEIN AUSGESCHRIEBEN, und das ist kein Zierwerk: `"äöüß".toUpperCase()`
// liefert "ÄÖÜSS" und schmuggelt damit ein S in die Zeichenklasse. Jedes
// Wort mit grossem S zaehlte dann als "hat ein Sonderzeichen", in `de`
// gemessen 56 statt 39. Weil die Schwelle mit demselben Fehler gemessen war,
// hob es sich auf und die Probe sah bestanden aus, waehrend sie eine Faltung
// durchliess. Gefunden am 07.11.2026 durch eine Sabotage, nicht durch Lesen.
const ZEICHEN = {
  ca: "àèéíïòóúüç·ÀÈÉÍÏÒÓÚÜÇ",
  cs: "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ",
  de: "äöüßÄÖÜ",
  es: "áéíóúñü¿¡ÁÉÍÓÚÑÜ",
  fr: "àâçéèêëîïôùûüÿœÀÂÇÉÈÊËÎÏÔÙÛÜŒ",
  it: "àèéìíòóùÀÈÉÌÍÒÓÙ",
  pl: "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
  "pt-BR": "áâãàçéêíóôõúÁÂÃÀÇÉÊÍÓÔÕÚ",
  "pt-PT": "áâãàçéêíóôõúÁÂÃÀÇÉÊÍÓÔÕÚ",
}

// Gemessen am 07.11.2026, NACH der Korrektur, ueber die 101 Pflichtschluessel
// dieser Datei und nicht nur ueber die Stream-Haelfte: so viele tragen je
// Sprache mindestens ein Sonderzeichen. Die Zahl kann nur wachsen oder durch
// eine Faltung fallen, also ist sie als UNTERGRENZE brauchbar. Wird ein Text
// entfernt, faellt sie auch, und dann gehoert sie neu gemessen; die Meldung
// sagt das.
//
// Beim ersten Bau standen hier die Zahlen der Stream-Haelfte allein, also je
// Sprache sechs bis sieben zu wenig, und `de` stand auf 56, weil das S aus
// "SS" mitzaehlte. Beide Male war die Probe zu locker. Die Zahlen hier sind
// mit der ausgeschriebenen Zeichenliste gemessen.
const MIT_ZEICHEN_MINDESTENS = {
  ca: 80, cs: 90, de: 39, es: 77, fr: 71,
  it: 43, pl: 83, "pt-BR": 69, "pt-PT": 70,
}

// Dazu die Summe aller Vorkommen, am 07.11.2026 gemessen. Diese Zahl ist die
// scharfe: sie faellt bei JEDER Faltung, auch mitten in einem Satz, der
// daneben weiter Sonderzeichen traegt. Dafuer faellt sie auch, wenn ein Text
// kuerzer formuliert wird, und dann gehoert sie neu gemessen. Das ist der
// Preis der Scharfe und bewusst bezahlt.
const VORKOMMEN_MINDESTENS = {
  ca: 221, cs: 844, de: 78, es: 185, fr: 245,
  it: 56, pl: 409, "pt-BR": 217, "pt-PT": 238,
}

function gefalteteFormen(code, text) {
  const treffer = new Set()
  for (const form of GEFALTET[code] || []) {
    for (const t of text.matchAll(new RegExp("\\b" + form, "gi"))) {
      treffer.add(t[0])
    }
  }
  return [...treffer]
}

function mitZeichen(code, d, schluessel = pflicht) {
  const z = new RegExp("[" + ZEICHEN[code] + "]")
  return schluessel.filter((k) => typeof d[k] === "string" && z.test(d[k])).length
}

// Und die Summe der VORKOMMEN, nicht der Werte. Sie ist die scharfe Zahl:
// ein Wert, der zehn Sonderzeichen traegt und eines verliert, bleibt oben
// gezaehlt und faellt hier auf. Gefunden am 07.11.2026 an einer Sabotage auf
// den tschechischen Fusstext, der "vazane" statt "vázané" bekam und von der
// Wertzaehlung durchgelassen wurde.
function zeichenVorkommen(code, d, schluessel = pflicht) {
  const z = new RegExp("[" + ZEICHEN[code] + "]", "g")
  let n = 0
  for (const k of schluessel) {
    if (typeof d[k] === "string") n += (d[k].match(z) || []).length
  }
  return n
}

let gefaltetGesamt = 0
let gepruefteSprachen = 0
const gefaltetJeSprache = []
for (const [code, d] of Object.entries(sprachen)) {
  if (!GEFALTET[code]) continue
  gepruefteSprachen++
  let n = 0
  for (const k of pflicht) {
    if (typeof d[k] !== "string") continue
    const formen = gefalteteFormen(code, d[k])
    if (!formen.length) continue
    n++
    if (zeigeListe) {
      console.log(`       gefaltet  ${code}  ${k}  ${formen.join(", ")}`)
    }
  }
  gefaltetGesamt += n
  if (n) gefaltetJeSprache.push(`${code}: ${n}`)
}

ok(`kein Streamtext traegt eine gefaltete Wortform (${Object.keys(GEFALTET).length} Sprachen mit Sonderzeichen)`,
  gefaltetGesamt === 0, gefaltetJeSprache.join(", "))

/*
 * Und wie viele Sprachen die Schleife wirklich erreicht hat. Faellt eine
 * heraus, sinkt die Trefferzahl auf null und der Satz darueber sieht aus wie
 * ein bestandener Lauf. Das ist dieselbe Klasse wie eine Suche, die nichts
 * findet, weil sie nicht mehr sucht.
 */
ok(`und die Schleife hat alle ${Object.keys(GEFALTET).length} Sprachen erreicht`,
  gepruefteSprachen === Object.keys(GEFALTET).length,
  `erreicht: ${gepruefteSprachen}`)

/*
 * Gegenprobe auf die Liste selbst. Eine Suche, die nichts findet, ist von
 * einer kaputten Suche nicht zu unterscheiden: faende das Muster gar nichts
 * mehr, meldete der Satz darueber null Treffer und sahe aus wie ein
 * bestandener Lauf. Deshalb wird hier ein absichtlich gefalteter Satz
 * durchgeschickt, und er MUSS anschlagen.
 */
const KOEDER = {
  de: "Das Video laedt waehrend des Spiels in voller Qualitaet.",
  cs: "Vase pripojeni nacitaji mapy.",
  pl: "Twoje polaczenie ciagnie mapy.",
  es: "La conexion se instala despues.",
  fr: "La video est deja telechargee.",
  it: "La velocita piena arriva gia cosi.",
  "pt-BR": "O video nao carrega, e tambem voce espera.",
}
const koederStumm = Object.entries(KOEDER)
  .filter(([code, satz]) => gefalteteFormen(code, satz).length === 0)
  .map(([code]) => code)

ok(`und die Suche schlaegt bei einem gefalteten Koedersatz an (${Object.keys(KOEDER).length} Sprachen geprobt)`,
  koederStumm.length === 0,
  koederStumm.length ? `stumm geblieben: ${koederStumm.join(", ")}` : "")

/*
 * Und die Probe auf die Probe. Wer die Koeder entfernt, macht aus dem Satz
 * darueber eine leere Pruefung: null stumme Sprachen, gruen, und die
 * Wortliste steht wieder ohne Schutz da. Dasselbe gilt fuer die Listen
 * selbst, eine geleerte findet nichts und meldet nichts.
 */
const dreiKleinsteListen = Object.values(GEFALTET)
  .map((l) => l.length).sort((a, b) => a - b).slice(0, 3)

ok("die Koeder und die Wortlisten sind nicht leer",
  Object.keys(KOEDER).length >= 7 && dreiKleinsteListen[0] >= 8,
  `Koeder: ${Object.keys(KOEDER).length} (mindestens 7), kleinste Listen: ${dreiKleinsteListen.join("/")} (mindestens 8)`)

/*
 * Die Gesamtmengenprobe, und sie ist die wichtigere von beiden: sie kennt
 * kein einzelnes Wort und faengt deshalb auch eine Faltung, die die Liste
 * oben nicht kennt. Faellt die Zahl der Werte mit Sonderzeichen unter den
 * gemessenen Stand, wurde entweder gefaltet oder ein Text entfernt.
 */
const gesunken = []
for (const [code, soll] of Object.entries(MIT_ZEICHEN_MINDESTENS)) {
  const d = sprachen[code]
  if (!d) {
    gesunken.push(`${code}: Sprachdatei fehlt`)
    continue
  }
  const ist = mitZeichen(code, d)
  if (ist < soll) gesunken.push(`${code}: ${ist} Werte statt mindestens ${soll}`)
  const sollV = VORKOMMEN_MINDESTENS[code]
  if (sollV === undefined) {
    gesunken.push(`${code}: keine Vorkommensschwelle`)
    continue
  }
  const istV = zeichenVorkommen(code, d)
  if (istV < sollV) {
    gesunken.push(`${code}: ${istV} Vorkommen statt mindestens ${sollV}`)
  }
}

ok("weder die Zahl der Werte mit Sonderzeichen noch die Summe der Vorkommen ist gefallen",
  gesunken.length === 0,
  gesunken.length
    ? `${gesunken.join(", ")}. Wurde ein Text ENTFERNT, ist MIT_ZEICHEN_MINDESTENS neu zu messen; wurde einer GEFALTET, gehoert das Zeichen zurueck`
    : "")

/*
 * Und die Probe auf diese Probe. Steht in MIT_ZEICHEN_MINDESTENS eine Null
 * oder fehlt eine Sprache, laesst sie alles durch und meldet trotzdem
 * gruen. Die Schwelle 30 ist bewusst weit unter dem kleinsten gemessenen
 * Stand (it: 43): sie faengt das Entwerten, nicht das Nachmessen.
 */
const entwertet = [
  ...Object.entries(MIT_ZEICHEN_MINDESTENS)
    .filter(([, n]) => !(n >= 30)).map(([code]) => `${code} (Werte)`),
  ...Object.entries(VORKOMMEN_MINDESTENS)
    .filter(([, n]) => !(n >= 50)).map(([code]) => `${code} (Vorkommen)`),
]
const ohneSchwelle = Object.keys(GEFALTET)
  .filter((code) => !(code in MIT_ZEICHEN_MINDESTENS)
    || !(code in VORKOMMEN_MINDESTENS))

ok(`jede der ${Object.keys(GEFALTET).length} Sprachen hat eine Schwelle, und keine ist entwertet`,
  entwertet.length === 0 && ohneSchwelle.length === 0,
  [entwertet.length ? `zu niedrig: ${entwertet.join(", ")}` : "",
    ohneSchwelle.length ? `ohne Schwelle: ${ohneSchwelle.join(", ")}` : ""]
    .filter(Boolean).join("; "))

/*
 * Und die Zaehlung selbst. Sie steht hier, weil der Satz darueber von einer
 * falschen Zahl nicht zu unterscheiden waere: gibt `mitZeichen` immer eine
 * grosse Zahl zurueck, ist nie etwas gefallen und alles gruen. Geprueft wird
 * gegen zwei gestellte Werte, von denen genau einer ein Sonderzeichen traegt.
 */
const PROBE_MIT = "mit"
const PROBE_OHNE = "ohne"
const zaehlProbe = Object.keys(ZEICHEN).filter((code) => {
  const erstes = ZEICHEN[code][0]
  const gestellt = {
    [PROBE_MIT]: `Text mit ${erstes}${erstes} darin`,
    // Rein lateinisch, beide Schreibungen und die Ziffern. Keine
    // Sonderzeichenklasse darf hier anschlagen, und genau daran faellt eine
    // zu WEITE Klasse auf: `"äöüß".toUpperCase()` schmuggelt ein S herein, und
    // das macht die Mengenprobe locker, ohne sie rot zu machen.
    [PROBE_OHNE]: "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789",
  }
  const schluessel = [PROBE_MIT, PROBE_OHNE]
  // Ein Wert von zwei traegt Zeichen, und darin stehen zwei davon.
  return mitZeichen(code, gestellt, schluessel) !== 1
    || zeichenVorkommen(code, gestellt, schluessel) !== 2
})

ok(`beide Zaehlungen stimmen an zwei gestellten Werten (${Object.keys(ZEICHEN).length} Sprachen geprobt)`,
  zaehlProbe.length === 0,
  zaehlProbe.length ? `falsch gezaehlt: ${zaehlProbe.join(", ")}` : "")

/*
 * Und jede Form der Wortlisten gegen sich selbst. Eine Form mit einem
 * Tippfehler trifft nie, meldet nie etwas und sieht wie eine bestandene
 * Pruefung aus. Der Koedersatz oben deckt nur die haeufigsten Formen ab,
 * dieser Satz deckt ALLE: aus jeder Form wird ein Text gebaut, in dem sie
 * stehen muss, und sie muss sich darin finden.
 */
const formStumm = []
for (const [code, formen] of Object.entries(GEFALTET)) {
  for (const form of formen) {
    // Aus dem Muster einen Text machen: die Anker und Wiederholungen weg,
    // der Rest ist das Wort selbst.
    const wort = form.replace(/\b/g, "").replace(/\w\*/g, "e")
      .replace(/\\./g, ".").replace(/\?/g, "")
    if (!gefalteteFormen(code, `Satz ${wort} Ende`).length) {
      formStumm.push(`${code}:${form}`)
    }
  }
}

const formenGesamt = Object.values(GEFALTET).reduce((n, l) => n + l.length, 0)
ok(`jede der ${formenGesamt} Wortformen findet sich im eigenen Text wieder`,
  formStumm.length === 0,
  formStumm.slice(0, 6).join(", "))

/* ------------------------------------------------------------------ Bilanz */

console.log(`\n${bestanden} bestanden, ${gescheitert} gescheitert`)
process.exit(gescheitert === 0 ? 0 : 1)
