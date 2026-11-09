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

/*
 * DIE MENGE DER SCHREIBWEISENPRUEFUNG, und sie ist eine ANDERE als `pflicht`.
 *
 * Die ersten drei Abschnitte fragen nach MENGE: ist jeder Streamtext
 * vorhanden, ist keiner englisch geblieben, ist keiner leer. Dafuer sind die
 * 101 Schluessel des Streamings und des Kontingents die richtige Menge, denn
 * nur fuer sie ist dieses Vorhaben zustaendig.
 *
 * Die Schreibweise ist dagegen eine Frage an JEDEN ausgelieferten Satz. Das
 * Modul liefert 2588 Schluessel je Sprache aus, und gemessen am 08.11.2026
 * standen 20 Werte AUSSERHALB des Streamings in der falschen Schreibweise,
 * darunter `BENEOS.Cloud.Install.NoPackDir` in allen acht Sprachen.
 * `OP-PRJ-201`.
 *
 * AUSGENOMMEN SIND DIE SUCHBEGRIFFE, und das ist kein Nachlassen, sondern der
 * Zweck des Feldes. `BENEOS.Wiki.Page.battlemaps.Search` steht im
 * Franzoesischen absichtlich in BEIDEN Formen, "video" neben "video" mit
 * Akut und "scene" neben "scene" mit Gravis, damit ein Kunde findet, was er
 * tippt. Gemessen: 35 solche Schluessel. Eine Wache, die sie mitnimmt, ist
 * eine Dauer-Rotmeldung, und eine Dauer-Rotmeldung ist keine Wache.
 */
const schreibweise = Object.keys(en).filter((k) => !/\.Search$/.test(k))

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

console.log("\nJeder ausgelieferte Textbaustein steht in der Schreibweise seiner Sprache")

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
    "mante\\b", "rapid(?:a|s|es)?", "paisos", "propia", "aqui\\b", "gairebe",
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
/*
 * DIESELBEN ZWEI FRAGEN NOCH EINMAL, UEBER DIE GANZE MENGE, und sie sind kein
 * Doppel. Die beiden Schwellen darueber messen die 101 Pflichtschluessel
 * punktgenau; diese hier messen alle 2614. Beides zusammen, weil keine Menge
 * die andere schuetzt: eine Faltung IN der Streamhaelfte koennte durch einen
 * neuen Textbaustein AUSSERHALB ausgeglichen werden, dann steigt die
 * Gesamtsumme trotz Verlust. Umgekehrt faengt nur die Gesamtsumme eine
 * Faltung in einem Baustein, den die Wortliste nicht kennt.
 *
 * Gemessen am 2026-11-08, NACH der Korrektur von `OP-PRJ-201`.
 */
const ALLE_WERTE_MINDESTENS = {
  ca: 1402, cs: 2041, de: 1012, es: 1241, fr: 1516,
  it: 588, pl: 1673, "pt-BR": 1344, "pt-PT": 1436,
}
const ALLE_VORKOMMEN_MINDESTENS = {
  ca: 6382, cs: 28879, de: 3878, es: 5482, fr: 9181,
  it: 1756, pl: 15508, "pt-BR": 8308, "pt-PT": 8135,
}

const VORKOMMEN_MINDESTENS = {
  ca: 221, cs: 844, de: 78, es: 185, fr: 245,
  it: 56, pl: 409, "pt-BR": 217, "pt-PT": 238,
}

/*
 * WER EINE FREMDSPRACHE ZITIERT, ZITIERT SIE. Die Oberflaeche von Foundry
 * heisst in jeder Sprache gleich, weil Foundry selbst nicht uebersetzt ist:
 * ein franzoesischer Text sagt "Clique sur le lien View Scene". Gemessen am
 * 08.11.2026 ueber alle neun Dateien: 55 mal "View Scene", 31 "Activate
 * Scene", 18 "Scene Directory", 18 "Change Scene", 18 "Scene Packer", 9
 * "Preload Scene", 4 "Scene Playlist", 2 "Scene Configuration". Nach deren
 * Abzug bleibt im Franzoesischen und Polnischen KEIN Treffer auf "scene"
 * uebrig, also waren alle 24 ein Fehlalarm.
 */
const ENGLISCHE_NAMEN = [
  "View Scene", "Activate Scene", "Scene Directory", "Change Scene",
  "Scene Packer", "Preload Scene", "Scene Playlist", "Scene Configuration",
  "In-Scene",
]

/*
 * WAS KEIN SATZ IST, WIRD VORHER ABGEZOGEN. Gemessen am 08.11.2026: der
 * franzoesische Tourtext steht richtig als "voyager entre les scenes" mit
 * Gravis, und der Treffer kam aus dem PLATZHALTER fuer den Szenennamen. Der
 * ist ein Variablenname, bleibt englisch und darf nie korrigiert werden.
 * Dasselbe gilt fuer HTML-Namen und Attribute, in denen etwa
 * data-page="dd-monks-active-tiles" steht. Ohne diesen Abzug meldete die Suche
 * 13 franzoesische und 19 polnische Werte, die alle richtig geschrieben sind.
 */
function nurSatz(s) {
  let t = String(s).replace(/\{[^}]*\}/g, " ").replace(/<[^>]*>/g, " ")
  for (const n of ENGLISCHE_NAMEN) t = t.split(n).join(" ")
  return t
}

/*
 * EINE WORTGRENZE IST IN JAVASCRIPT ASCII-BASIERT, und das ist der schaerfste
 * dieser Fehlalarme, weil er genau die RICHTIGE Schreibung trifft. Fuer die
 * Grenze ist jedes Sonderzeichen ein Wortende, also passt die polnische Form
 * "powod" mit Grenze auf das richtig geschriebene "powodow" mit o-Akut, und
 * "traves" auf das spanische "travesia". Dazu die Zusammensetzungen: ein
 * nacktes "video" ist in es, ca und pt falsch, aber "videojuego", "videojoc",
 * "videogame" und "videotutorial" sind richtig, weil die Vorsilbe dort keinen
 * Akzent traegt.
 *
 * Deshalb beidseitig scharfe Anker: weder ein Buchstabe noch ein Sonderzeichen
 * darf anschliessen. Gemessen hat das die Restmenge von 47 auf 26 gebracht,
 * ohne der Streamhaelfte einen einzigen Treffer zu nehmen.
 */
const WORT = "[\\w\\u00c0-\\u024f]"

function gefalteteFormen(code, text) {
  const treffer = new Set()
  const satz = nurSatz(text)
  for (const form of GEFALTET[code] || []) {
    const muster = `(?<!${WORT})(?:${form})(?!${WORT})`
    for (const t of satz.matchAll(new RegExp(muster, "gi"))) {
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
/*
 * WIE VIELE BAUSTEINE DIE SUCHE WIRKLICH GELESEN HAT, und dieser Zaehler ist
 * keine Zierde. Eine Sabotage am 08.11.2026 setzte die Schleife von
 * `schreibweise` auf `pflicht` zurueck, also von 2614 auf 101 Schluessel, und
 * der Lauf BLIEB GRUEN: weil alle Werte in Ordnung sind, meldet eine kleinere
 * Menge genauso null Treffer. Die Deckung war weg und nichts sagte es.
 *
 * Dieselbe Klasse wie die Sprachzahl darunter: eine Probe muss sagen, wie viel
 * sie gemessen hat, sonst ist ein Deckungsverlust von einem bestandenen Lauf
 * nicht zu unterscheiden.
 */
let geleseneBausteine = 0
const gefaltetJeSprache = []
for (const [code, d] of Object.entries(sprachen)) {
  if (!GEFALTET[code]) continue
  gepruefteSprachen++
  let n = 0
  // UEBER ALLE AUSGELIEFERTEN BAUSTEINE, nicht nur die des Streamings. Siehe
  // die Begruendung an `schreibweise` oben: die Schreibweise ist eine Frage an
  // jeden Satz, den ein Kunde liest.
  for (const k of schreibweise) {
    if (typeof d[k] !== "string") continue
    geleseneBausteine++
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

ok(`kein ausgelieferter Textbaustein traegt eine gefaltete Wortform (${schreibweise.length} Schluessel, ${Object.keys(GEFALTET).length} Sprachen mit Sonderzeichen)`,
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
 * Und wie viele Bausteine sie dabei wirklich gelesen hat. Die Schranke 15.000
 * liegt bewusst unter dem gemessenen Stand von 9 Sprachen mal rund 2.580
 * vorhandenen Werten: sie faengt das Zurueckfallen auf eine kleine Menge, nicht
 * das Wachsen oder Schrumpfen des Bestands um einzelne Bausteine.
 */
ok(`und sie hat dabei genug Bausteine gelesen (${geleseneBausteine})`,
  geleseneBausteine >= 15000,
  `gelesen: ${geleseneBausteine}. Faellt die Zahl stark, wurde die gepruefte Menge verkleinert; waechst sie, ist die Schranke nachzumessen`)

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
const benutzteSchranken = []
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

  // Und dieselben zwei Fragen ueber ALLE ausgelieferten Bausteine.
  const sollA = ALLE_WERTE_MINDESTENS[code]
  const sollAV = ALLE_VORKOMMEN_MINDESTENS[code]
  if (sollA === undefined || sollAV === undefined) {
    gesunken.push(`${code}: keine Gesamtschwelle`)
    continue
  }
  const istA = mitZeichen(code, d, schreibweise)
  if (istA < sollA) {
    gesunken.push(`${code}: ${istA} Werte gesamt statt mindestens ${sollA}`)
  }
  const istAV = zeichenVorkommen(code, d, schreibweise)
  if (istAV < sollAV) {
    gesunken.push(`${code}: ${istAV} Vorkommen gesamt statt mindestens ${sollAV}`)
  }
  // WAS WIRKLICH VERGLICHEN WURDE. Eine Sabotage setzte `sollA` und `sollAV`
  // im Rumpf auf null; die Entwertungsprobe darunter prueft die KONSTANTEN und
  // sah davon nichts, der Lauf blieb gruen. Deshalb werden hier die wirklich
  // benutzten Schranken mitgeschrieben.
  benutzteSchranken.push(sollA, sollAV)
}

ok("weder die Zahl der Werte mit Sonderzeichen noch die Summe der Vorkommen ist gefallen, in keiner der beiden Mengen",
  gesunken.length === 0,
  gesunken.length
    ? `${gesunken.join(", ")}. Wurde ein Text ENTFERNT, ist MIT_ZEICHEN_MINDESTENS neu zu messen; wurde einer GEFALTET, gehoert das Zeichen zurueck`
    : "")

/*
 * Und die Probe darauf, dass wirklich verglichen wurde. Eine Sabotage am
 * 08.11.2026 setzte die beiden Gesamtschranken IM RUMPF auf null, nicht in den
 * Konstanten; damit waren alle Vergleiche wirkungslos und der Lauf blieb
 * gruen, weil die Entwertungsprobe darunter nur die Konstanten liest.
 */
const stilleSchranken = benutzteSchranken.filter((n) => !(n >= 400)).length
ok(`und jeder Vergleich lief gegen eine echte Schranke (${benutzteSchranken.length} Vergleiche)`,
  stilleSchranken === 0 && benutzteSchranken.length >= 18,
  `${stilleSchranken} Vergleiche liefen gegen eine zu kleine Schranke, ${benutzteSchranken.length} Vergleiche insgesamt`)

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
  // Dieselbe Probe fuer die beiden Gesamtschwellen. Ohne sie waere die neue
  // Menge von 2614 Schluesseln mit einer Null entwertbar, waehrend die
  // Streamhaelfte weiter gruen meldet. Die Schranken liegen wieder weit unter
  // dem kleinsten gemessenen Stand (it: 588 Werte, 1.756 Vorkommen).
  ...Object.entries(ALLE_WERTE_MINDESTENS)
    .filter(([, n]) => !(n >= 400)).map(([code]) => `${code} (Werte gesamt)`),
  ...Object.entries(ALLE_VORKOMMEN_MINDESTENS)
    .filter(([, n]) => !(n >= 1000)).map(([code]) => `${code} (Vorkommen gesamt)`),
]
const ohneSchwelle = Object.keys(GEFALTET)
  .filter((code) => !(code in MIT_ZEICHEN_MINDESTENS)
    || !(code in VORKOMMEN_MINDESTENS)
    || !(code in ALLE_WERTE_MINDESTENS)
    || !(code in ALLE_VORKOMMEN_MINDESTENS))

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

/* ------------------------- 5. Platzhalter stehen zeichengleich in jeder Sprache */

console.log("\nJeder Platzhalter steht in jeder Sprache zeichengleich")

/*
 * WARUM DIESER ABSCHNITT GEBRAUCHT WIRD, und warum er heute nichts BEHEBT.
 *
 * `OP-PRJ-151` verlangt zwei Dinge: "Je Sprache die Zahl der Schluessel gegen
 * `lang/en.json` halten, Platzhalter zeichengleich." Die Zahl prueft
 * Abschnitt 2 seit Langem. DIE PLATZHALTER PRUEFTE BIS ZUM 08.11.2026
 * NIEMAND, und das ist eine Deckungsluecke und kein Fehlverhalten: gemessen
 * an diesem Tag stehen ueber alle 13 Uebersetzungen NULL Abweichungen.
 *
 * Der Schaden waere stiller als ein fehlender Schluessel. Ein fehlender
 * Schluessel faellt in Foundry als roher Punktpfad auf. Ein falsch
 * geschriebener Platzhalter laesst den Satz richtig aussehen und zeigt an der
 * Stelle des Werts woertlich `{name}`, oder gar nichts: `format()` ersetzt
 * nur, was es kennt. Eine Meldung ueber eine fehlgeschlagene Installation
 * ohne den Namen der Kreatur ist genau an der Stelle nutzlos, an der sie
 * gebraucht wird.
 *
 * ES GIBT ZWEI FORMEN, UND DAS IST GEMESSEN UND NICHT GERATEN. Die geschweifte
 * ist die von Foundry (`format()`), und sie traegt 198 Schluessel. Die
 * Prozentform traegt 6 und liegt in `BENEOS.Cloud.Bmap.*`, wo das Modul selbst
 * ersetzt. Eine Wache, die nur eine Form kennt, ist fuer die andere blind, und
 * die Prozentform ist die aeltere; wer sie uebersieht, prueft die neuen Texte
 * und laesst die alten liegen.
 *
 * DIE MENGE IST DIE GANZE DATEI UND NICHT NUR DAS STREAMING, aus demselben
 * Grund wie bei der Schreibweise in Abschnitt 4: ein falscher Platzhalter in
 * `BENEOS.Cloud.*` ist derselbe Fehler. Das darf hier stehen, weil die
 * Gesamtmenge heute gemessen sauber ist; eine Wache, die am ersten Tag rot
 * ist, wird abgeschaltet.
 *
 * VERGLICHEN WIRD DIE SORTIERTE LISTE MIT MEHRFACHVORKOMMEN und nicht die
 * Menge der Namen. Steht `{count}` im Englischen zweimal, braucht der Satz
 * zwei Stellen, und eine Uebersetzung mit einer ist eine andere Aussage. Das
 * ist die strengere Lesart, und sie ist zulaessig, weil sie heute haelt. Faellt
 * sie je ueber einen Satz, der wirklich umgebaut gehoert, ist der Ausgang eine
 * Ausnahme mit Begruendung und nicht das Aufweichen des Vergleichs.
 *
 * EIN FEHLENDER SCHLUESSEL IST HIER KEIN BEFUND. Dafuer ist Abschnitt 2 da,
 * und zwar fuer die 101 Pflichtschluessel dieses Vorhabens. Gemessen am
 * 08.11.2026 fehlen 64 Platzhalterschluessel der GESAMTMENGE in mindestens
 * einer Sprache; sie hier mitzuzaehlen hiesse, einen fremden Befund in diesen
 * Satz zu holen, und er waere ab dem ersten Tag rot.
 */
const PLATZHALTER_FORMEN = [
  ["geschweift", /\{[A-Za-z_][A-Za-z0-9_]*\}/g],
  ["prozent", /%[A-Za-z_][A-Za-z0-9_]*%/g],
]

/*
 * Die Mindestzahlen sind GEMESSEN am 08.11.2026 und stehen als Schranke nach
 * unten. Ohne sie waere der Satz auch gruen, wenn das Muster nichts mehr
 * findet, und das ist von einer sauberen Datei nicht zu unterscheiden.
 */
const PLATZHALTER_MIND = { geschweift: 198, prozent: 6 }

/*
 * UND DIE SCHRANKE BRAUCHT IHRE EIGENE PROBE, denn eine Zahl, die im Rumpf
 * ihres Satzes steht, prueft niemand. Am 08.11.2026 ist das zweimal gemessen
 * worden: eine Sabotage setzte `PLATZHALTER_MIND` auf null, und der Satz blieb
 * gruen, weil `198 >= 0` wahr ist. Dieselbe Lehre traegt
 * `tools/pruefe-bildform-adresse.php` in `OP-PRJ-190`.
 *
 * DIE RECHNUNG STEHT DESHALB ALS HELFER, und Satz und Gegenprobe benutzen
 * DENSELBEN. Wer ihn aufweicht, macht damit die Gegenprobe rot, und die
 * entsteht an einer anderen Stelle als der Satz.
 *
 * GEPRUEFT WIRD EIN ABSTAND UND KEINE GLEICHHEIT. Eine Schranke, die der
 * gefundenen Zahl gleichen muesste, waere bei jedem neuen Textbaustein rot,
 * also eine Dauer-Rotmeldung. Gefordert ist die Haelfte: eine Schranke unter
 * der Haelfte des Bestands sagt nichts mehr, eine darueber faengt jeden
 * Einbruch, der mehr als die Haelfte wegnimmt.
 */
function mindTraegt(mind, gefunden) {
  return mind > 0 && gefunden > 0 && mind >= Math.floor(gefunden / 2)
}

function platzhalterVon(text, muster) {
  return String(text).match(muster)?.slice().sort() || []
}

function platzhalterAbweichungen(muster, quelle, mengen) {
  const soll = new Map()
  for (const [k, v] of Object.entries(quelle)) {
    if (typeof v !== "string") continue
    const p = platzhalterVon(v, muster)
    if (p.length) soll.set(k, p)
  }
  const schlecht = []
  let paare = 0
  for (const [code, d] of Object.entries(mengen)) {
    if (code === "en") continue
    for (const [k, sollListe] of soll) {
      if (typeof d[k] !== "string") continue   // fehlt: Abschnitt 2
      paare++
      const ist = platzhalterVon(d[k], muster)
      if (ist.join("\u0001") !== sollListe.join("\u0001")) {
        schlecht.push(`${code}:${k} soll [${sollListe}] ist [${ist}]`)
      }
    }
  }
  return { soll, schlecht, paare }
}

/*
 * DIE ZAHL DER FORMEN IST EIN EIGENER SATZ, und sie ist am 08.11.2026 von
 * einer Sabotage erzwungen worden: wer die Prozentform aus der Liste nimmt,
 * verliert die Pruefung fuer sechs Schluessel, und KEIN Satz wurde rot. Der
 * Paarzaehler faengt das nicht, denn die geschweifte Form bringt allein 2510
 * Paare und die Schranke darunter liegt bei 1300.
 *
 * Eine Schleife ueber eine zu kurze Liste laeuft fehlerfrei durch. Dieselbe
 * Lehre steht in `OP-PRJ-170` und in `OP-SYS-289`: der wichtigste Satz prueft
 * eine GESAMTMENGE, nicht die Glieder, die der Stand gerade nennt.
 */
ok(`die Formenliste nennt genau ${2} Platzhalterformen`,
  PLATZHALTER_FORMEN.length === 2,
  `gefunden: ${PLATZHALTER_FORMEN.length}`)
ok("und zwar die geschweifte und die Prozentform",
  PLATZHALTER_FORMEN.map(([n]) => n).sort().join(",") === "geschweift,prozent",
  PLATZHALTER_FORMEN.map(([n]) => n).join(","))
ok("jede Form hat ihre eigene Mindestzahl",
  PLATZHALTER_FORMEN.every(([n]) => typeof PLATZHALTER_MIND[n] === "number"),
  Object.keys(PLATZHALTER_MIND).join(","))

let paareGesamt = 0
for (const [formName, muster] of PLATZHALTER_FORMEN) {
  const r = platzhalterAbweichungen(muster, en, sprachen)
  paareGesamt += r.paare

  ok(`kein Platzhalter der Form "${formName}" weicht ab `
    + `(${r.soll.size} Schluessel, ${r.paare} Paare)`,
    r.schlecht.length === 0,
    r.schlecht.slice(0, 5).join(" | "))

  // Die Schranke nach unten. Ein Muster, das nichts mehr findet, ist von
  // einer sauberen Datei nicht zu unterscheiden.
  ok(`die Form "${formName}" findet noch mindestens `
    + `${PLATZHALTER_MIND[formName]} Schluessel`,
    r.soll.size >= PLATZHALTER_MIND[formName],
    `gefunden: ${r.soll.size}`)

  // Und die Schranke selbst ist nicht entwertet. Begruendung bei `mindTraegt`.
  ok(`die Schranke der Form "${formName}" ist streng genug `
    + `(${PLATZHALTER_MIND[formName]} gegen ${r.soll.size} gefundene)`,
    mindTraegt(PLATZHALTER_MIND[formName], r.soll.size),
    `eine Schranke unter der Haelfte des Bestands sagt nichts`)

  /*
   * DER PAARZAEHLER BRAUCHT EINE OBERGRENZE UND NICHT NUR EINE UNTERGRENZE,
   * und das ist am 08.11.2026 von einer Sabotage erzwungen worden: `paare +=
   * 99999` statt `paare++` liess die Untergrenze weiter unten trivial halten,
   * und kein Satz wurde rot. Ein Sammler, der nur nach unten geprueft wird,
   * ist von einem gefaelschten nicht zu unterscheiden.
   *
   * DIE OBERGRENZE ENTSTEHT AUS DER STRUKTUR und nicht aus einer gemerkten
   * Zahl: mehr Paare als Uebersetzungen mal Sollschluessel kann es nicht
   * geben, denn je Paar steht genau ein Schluessel in genau einer Sprache.
   * Mit beiden Grenzen ist die Zahl eingeklammert, und zwar von zwei Seiten,
   * die verschieden entstehen.
   */
  const paareMax = (dateien.length - 1) * r.soll.size
  ok(`die Paarzahl der Form "${formName}" liegt in der Klammer `
    + `(${r.paare} von hoechstens ${paareMax})`,
    r.paare > 0 && r.paare <= paareMax,
    `${r.paare} Paare bei ${r.soll.size} Schluesseln und `
    + `${dateien.length - 1} Uebersetzungen`)

  /*
   * UND DIE OBERGRENZE SELBST IST NICHT WEGGESETZT. Eine Klammer, die bei
   * `Number.MAX_SAFE_INTEGER` liegt, ist keine, und am 08.11.2026 ist genau
   * das durchgekommen. Dagegen hilft nur eine zweite, WEITERE Klammer: mehr
   * als alle Schluessel der Leitsprache mal alle Uebersetzungen kann kein
   * Vergleich je machen, und diese Zahl entsteht an einer anderen Stelle als
   * `r.soll.size`.
   *
   * HIER ENDET DIE KETTE BEWUSST. Eine Klammer um die Klammer um die Klammer
   * ist ein Regress ohne Ende; was eine Sabotage an einem RUMPF aendert, faengt
   * irgendwann kein Satz mehr, und dagegen schuetzt die Durchsicht des Diffs.
   * Festgehalten als die benannte Grenze dieser Methode, siehe `OP-PRJ-151`.
   */
  ok(`die Obergrenze der Form "${formName}" ist selbst begrenzt`,
    paareMax > 0 && paareMax <= (dateien.length - 1) * Object.keys(en).length,
    `${paareMax} gegen `
    + `${(dateien.length - 1) * Object.keys(en).length}`)

  if (zeigeListe && r.schlecht.length) {
    for (const z of r.schlecht) console.log(`       platzhalter  ${z}`)
  }
}

/*
 * DIE GEGENPROBE, und sie ist der Satz, der diesen Abschnitt erst zu einem
 * Satz macht. Null Abweichungen ueber eine saubere Datei sieht genauso aus wie
 * null Abweichungen ueber ein kaputtes Muster. Gestellt werden deshalb VIER
 * Fehlerarten, und jede muss gefunden werden: ein umbenannter Platzhalter, ein
 * weggefallener, ein dazugekommener und ein zweites Vorkommen, das zu einem
 * wurde.
 */
const KOEDER_EN = {
  "Probe.Um": "Hello {name}, you have {count} left",
  "Probe.Weg": "Hello {name}, you have {count} left",
  "Probe.Mehr": "Hello {name}",
  "Probe.Heil": "Hello {name}, you have {count} left",
  "Probe.Zwei": "{name} and again {name}",
}
const KOEDER_DE = {
  "Probe.Um": "Hallo {nom}, du hast {count} uebrig",      // umbenannt
  "Probe.Weg": "Hallo du hast {count} uebrig",            // einer weg
  "Probe.Mehr": "Hallo {name}, du hast {count} uebrig",   // einer dazu
  "Probe.Heil": "Hallo {name}, du hast {count} uebrig",   // heil
  "Probe.Zwei": "{name} und noch einmal dasselbe",        // zwei auf eines
}
const probe = platzhalterAbweichungen(/\{[A-Za-z_][A-Za-z0-9_]*\}/g,
  KOEDER_EN, { en: KOEDER_EN, de: KOEDER_DE })
const probeKeys = probe.schlecht.map((z) => z.split(" ")[0])

/*
 * DIE VIER KOEDER STEHEN IN EINEM SATZ UND NICHT IN VIER, und das ist am
 * 08.11.2026 von einer Sabotage erzwungen worden. Als jeder Koeder seinen
 * eigenen Satz hatte, liess sich einer auf `probe.schlecht.length > 0`
 * aufweichen, und die drei anderen blieben gruen; der Satz prueft dann die
 * ANWESENHEIT eines Befundes und nicht mehr, WELCHER es ist.
 *
 * Ein Vergleich der ganzen Liste hat nur eine Stelle. Wer sie aufweicht,
 * verliert alle vier auf einmal, und das faellt in der Durchsicht auf. Dass
 * der heile Koeder NICHT in der Liste steht, ist dabei mitgeprueft, und zwar
 * ohne einen eigenen Satz: eine Liste, die ihn enthaelt, ist eine andere.
 */
const KOEDER_SOLL = ["de:Probe.Mehr", "de:Probe.Um", "de:Probe.Weg",
  "de:Probe.Zwei"]
ok(`die Probe findet genau die ${KOEDER_SOLL.length} verdorbenen Koeder `
  + "und nicht den heilen",
  probeKeys.slice().sort().join(",") === KOEDER_SOLL.join(","),
  `gefunden: [${probeKeys.slice().sort()}], erwartet: [${KOEDER_SOLL}]`)

// Und die Liste selbst ist nicht leer geraeumt. Ein Vergleich von "" mit ""
// haelt, und das sieht wie ein bestandener Satz aus.
ok(`die Koederliste nennt ${KOEDER_SOLL.length} Faelle und der Koeder `
  + `${Object.keys(KOEDER_DE).length} Saetze`,
  KOEDER_SOLL.length === 4 && Object.keys(KOEDER_DE).length === 5
  && Object.keys(KOEDER_EN).length === 5,
  `${KOEDER_SOLL.length} / ${Object.keys(KOEDER_DE).length}`)

/*
 * UND DIE PROZENTFORM BRAUCHT IHRE EIGENE GEGENPROBE. Ein Muster, das fuer
 * sie nie anschlaegt, laesst den Satz oben gruen, weil `soll` dann leer ist;
 * die Schranke faengt das, aber nur die Zahl und nicht die Trennschaerfe.
 */
const PROZ_EN = { "P.Um": "Install %name% now", "P.Heil": "Install %name% now" }
const PROZ_DE = { "P.Um": "Installiere %nom% jetzt", "P.Heil": "Installiere %name% jetzt" }
const proz = platzhalterAbweichungen(/%[A-Za-z_][A-Za-z0-9_]*%/g,
  PROZ_EN, { en: PROZ_EN, de: PROZ_DE })
ok("die Prozentprobe trennt den umbenannten vom heilen",
  proz.schlecht.length === 1 && proz.schlecht[0].startsWith("de:P.Um"),
  proz.schlecht.join(" | "))

/*
 * DIE DRITTE GEGENPROBE ZIELT AUF DIE SCHLEIFE SELBST. Sie laeuft ueber
 * `Object.entries(sprachen)`, und wer dort `break` statt `continue` schreibt,
 * prueft eine Sprache und hoert auf; der Satz bleibt gruen. Gezaehlt wird
 * deshalb, wie viele Paare wirklich verglichen wurden.
 */
const SPRACHEN_OHNE_EN = dateien.length - 1
const PAARE_MAX_GESAMT = SPRACHEN_OHNE_EN * Object.keys(en).length
// Dieselbe zweite Klammer fuer die Summe. Begruendung oben in der Schleife.
ok("die Gesamtobergrenze ist selbst begrenzt",
  PAARE_MAX_GESAMT > 0 && PAARE_MAX_GESAMT <= 13 * 10000,
  `${PAARE_MAX_GESAMT}`)
ok(`die Schleife hat alle ${SPRACHEN_OHNE_EN} Uebersetzungen erreicht `
  + `(${paareGesamt} Paare, hoechstens ${PAARE_MAX_GESAMT})`,
  paareGesamt >= SPRACHEN_OHNE_EN * 100
  && paareGesamt <= PAARE_MAX_GESAMT,
  `${paareGesamt} Paare bei ${SPRACHEN_OHNE_EN} Sprachen und `
  + `${Object.keys(en).length} Schluesseln`)

/*
 * DIE VIERTE GEGENPROBE PRUEFT DIE RECHNUNG DER SCHRANKE, nicht ihre Zahl.
 * Sie steht hier und nicht in der Schleife, weil sie keine Sprachdatei
 * braucht; und sie benutzt DENSELBEN Helfer, den die Schleife benutzt. Wer ihn
 * aufweicht, macht genau diese drei Zeilen rot.
 */
ok("die Schrankenrechnung weist eine entwertete Schranke ab",
  !mindTraegt(0, 198) && !mindTraegt(5, 198) && !mindTraegt(98, 198))
ok("und laesst eine strenge durch",
  mindTraegt(198, 198) && mindTraegt(99, 198) && mindTraegt(198, 250))
ok("und sie weist eine leere Grundmenge ab",
  !mindTraegt(198, 0) && !mindTraegt(0, 0))

/* ----------- 6. Jeder Platzhalter wird von seinem Aufrufer gefuellt */

console.log("\nJeder Platzhalter wird von seinem Aufrufer gefuellt")

/*
 * WARUM DIESER ABSCHNITT GEBRAUCHT WIRD, und er schliesst die Luecke, die
 * Abschnitt 5 seit dem 08.11.2026 selbst benennt.
 *
 * Abschnitt 5 vergleicht die dreizehn Uebersetzungen GEGENEINANDER. Steht in
 * allen dreizehn dasselbe `{seconds}`, das kein Aufrufer liefert, ist er
 * gruen und der Kunde sieht woertlich `{seconds}`. `OP-PRJ-151` fuehrt genau
 * das als "nicht geprueft": "ein `{seconds}`, das kein Aufrufer liefert,
 * bleibt in dreizehn Sprachen gleich falsch."
 *
 * Dieser Abschnitt fragt deshalb nach der ANDEREN Richtung: nennt der
 * Aufrufer jeden Platzhalter, den sein Text verlangt. Gemessen am 09.11.2026
 * sind es NULL Befunde, und das ist der Grund, warum er gebaut werden durfte.
 * Eine Wache, die am ersten Tag rot ist, wird abgeschaltet.
 *
 * DREI MESSWEGE HABEN VORHER FALSCH GEMESSEN, und jeder sah nach einem Befund
 * aus. Sie stehen hier, weil der naechste Leser sie sonst neu macht:
 *   1. Ein Muster, das nur `.format(` kennt, meldet 69 Schluessel als ohne
 *      Aufrufer. Das Modul ruft ueber eigene Helfer, `Lf()`, `this.#f()` und
 *      `this._confirm()`, und jeder uebergibt sein Objektliteral genauso.
 *      Darum steht hier ein BELIEBIGER Aufrufname vor der Klammer.
 *   2. Ein Namensleser, der einen Doppelpunkt verlangt, meldete 22 Aufrufer
 *      als unvollstaendig. Alle 22 benutzten die Kurzschreibweise `{ name }`.
 *      Darum liest `objektNamen` beide Formen, und der Koeder `K6.Kurz`
 *      haelt das fest.
 *   3. Ein Leser, der nur Javascript kennt, meldete zwoelf Schluessel des
 *      Offline-Fensters. Sie stehen in Handlebars, und dort fuellt
 *      `{{localize "K" used=a limit=b}}` ueber Hash-Angaben.
 */

const QUELLORDNER = ["scripts", "templates", "tools"]
const QUELLENDUNGEN = [".js", ".mjs", ".hbs", ".html"]

function quellenSammeln(ordner) {
  const raus = []
  const lauf = (p) => {
    let eintraege
    try { eintraege = readdirSync(p, { withFileTypes: true }) } catch { return }
    for (const e of eintraege) {
      if (e.name === "node_modules" || e.name === ".git") continue
      const voll = join(p, e.name)
      if (e.isDirectory()) lauf(voll)
      else if (QUELLENDUNGEN.some((x) => e.name.endsWith(x))) raus.push(voll)
    }
  }
  for (const o of ordner) lauf(join(WURZEL, o))
  return raus
}

/*
 * Das Objektliteral wird ueber die KLAMMERTIEFE gelesen und nicht mit einem
 * Muster. Ein Muster bis zur naechsten schliessenden Klammer bricht an jedem
 * verschachtelten Objekt ab, und `{ name: x, teile: { a: 1 } }` ist der
 * Normalfall und nicht die Ausnahme.
 */
function literalAb(text, start) {
  let tiefe = 0
  for (let j = start; j < Math.min(start + 4000, text.length); j++) {
    const c = text[j]
    if (c === "{") tiefe++
    else if (c === "}") {
      tiefe--
      if (tiefe === 0) return text.slice(start + 1, j)
    }
  }
  return null
}

function objektNamen(lit) {
  const n = new Set()
  // Form `name: wert`
  for (const m of lit.matchAll(/(?:^|[,{\s])([A-Za-z_]\w*)\s*:/g)) n.add(m[1])
  // Kurzschreibweise `{ name }` und `{ name, zahl }`. Siehe Messweg 2 oben.
  for (const teil of lit.split(/,(?![^{[(]*[}\])])/)) {
    const t = teil.trim()
    if (/^[A-Za-z_]\w*$/.test(t)) n.add(t)
  }
  return n
}

/*
 * DIE FORMENLISTE IST EINE GESAMTMENGE und bekommt darum ihren eigenen Satz,
 * dieselbe Lehre wie bei `PLATZHALTER_FORMEN` in Abschnitt 5: wer eine Form
 * aus der Liste nimmt, verliert ihre Pruefung, und keine Zahl wird rot, weil
 * die andere Form allein die Schranke traegt.
 */
const AUFRUFFORMEN = ["javascript", "handlebars"]
const RE_AUFRUF_JS = /[A-Za-z_$#][\w$#]*\(\s*(["'`])([A-Za-z0-9_.]+)\1\s*,\s*\{/g
const RE_AUFRUF_HBS = /\{\{[#~]?\s*localize\s+(["'`])([A-Za-z0-9_.]+)\1([^}]*)\}\}/g

function aufrufeSammeln(texte) {
  const gefuellt = new Map()
  const offen = new Set()
  const jeForm = { javascript: 0, handlebars: 0 }
  const nimm = (k, namen) => {
    if (!gefuellt.has(k)) gefuellt.set(k, new Set())
    for (const n of namen) gefuellt.get(k).add(n)
  }
  for (const text of texte) {
    for (const m of text.matchAll(RE_AUFRUF_JS)) {
      const lit = literalAb(text, m.index + m[0].length - 1)
      if (lit === null) continue
      jeForm.javascript++
      // Ein `...daten` kann jeden Namen tragen. Was es traegt, steht hier
      // nicht, also wird dieser Schluessel NICHT beanstandet und
      // stattdessen gezaehlt. Eine Vermutung waere ein Fehlalarm.
      if (lit.includes("...")) offen.add(m[2])
      nimm(m[2], objektNamen(lit))
    }
    for (const m of text.matchAll(RE_AUFRUF_HBS)) {
      jeForm.handlebars++
      nimm(m[2], [...m[3].matchAll(/([A-Za-z_]\w*)\s*=/g)].map((x) => x[1]))
    }
  }
  return { gefuellt, offen, jeForm }
}

function sollNamen(quelle) {
  const soll = new Map()
  for (const [k, v] of Object.entries(quelle)) {
    if (typeof v !== "string") continue
    const namen = [...new Set([...v.matchAll(/\{([A-Za-z_]\w*)\}/g)]
      .map((m) => m[1]))].sort()
    if (namen.length) soll.set(k, namen)
  }
  return soll
}

function ungefuellte(soll, gefuellt, offen) {
  const schlecht = []
  let geprueft = 0, ohneAufruf = 0, mitSpread = 0
  for (const [k, sollListe] of soll) {
    if (!gefuellt.has(k)) { ohneAufruf++; continue }
    if (offen.has(k)) { mitSpread++; continue }
    geprueft++
    const da = gefuellt.get(k)
    const fehlt = sollListe.filter((p) => !da.has(p))
    if (fehlt.length) {
      schlecht.push(`${k} fehlt [${fehlt}] gefuellt [${[...da].sort()}]`)
    }
  }
  return { schlecht, geprueft, ohneAufruf, mitSpread }
}

const quellDateien = quellenSammeln(QUELLORDNER)
const quellTexte = quellDateien.map((p) => readFileSync(p, "utf8"))
const { gefuellt: aufrufe, offen: aufrufOffen, jeForm } =
  aufrufeSammeln(quellTexte)
const soll6 = sollNamen(en)
const r6 = ungefuellte(soll6, aufrufe, aufrufOffen)

/*
 * Die Mindestzahlen sind GEMESSEN am 09.11.2026 und stehen als Schranke nach
 * unten, mit derselben Begruendung und demselben Helfer wie in Abschnitt 5:
 * ein Sammler, der nichts mehr findet, ist von einem sauberen Bestand nicht
 * zu unterscheiden, und eine Schranke im Rumpf ihres eigenen Satzes prueft
 * niemand.
 */
const AUFRUF_MIND = { dateien: 223, javascript: 233, handlebars: 720,
  geprueft: 166 }

ok(`die Formenliste nennt genau ${AUFRUFFORMEN.length} Aufrufformen`,
  AUFRUFFORMEN.length === 2, `gefunden: ${AUFRUFFORMEN.length}`)
ok("und zwar javascript und handlebars",
  AUFRUFFORMEN.slice().sort().join(",") === "handlebars,javascript",
  AUFRUFFORMEN.join(","))
ok("jede Form hat Aufrufstellen gefunden",
  AUFRUFFORMEN.every((f) => jeForm[f] > 0),
  AUFRUFFORMEN.map((f) => `${f}=${jeForm[f]}`).join(", "))

ok(`kein Platzhalter bleibt unbefuellt `
  + `(${r6.geprueft} Schluessel geprueft, ${r6.ohneAufruf} ohne Aufrufer, `
  + `${r6.mitSpread} mit Streuung)`,
  r6.schlecht.length === 0,
  r6.schlecht.slice(0, 5).join(" | "))

ok(`der Sammler hat mindestens ${AUFRUF_MIND.dateien} Quelldateien gelesen`,
  quellDateien.length >= AUFRUF_MIND.dateien, `${quellDateien.length}`)
ok(`und die Schranke darauf ist streng genug`,
  mindTraegt(AUFRUF_MIND.dateien, quellDateien.length),
  `${AUFRUF_MIND.dateien} gegen ${quellDateien.length}`)

for (const f of AUFRUFFORMEN) {
  ok(`die Form "${f}" findet noch mindestens ${AUFRUF_MIND[f]} Aufrufstellen`,
    jeForm[f] >= AUFRUF_MIND[f], `${jeForm[f]}`)
  ok(`und die Schranke der Form "${f}" ist streng genug`,
    mindTraegt(AUFRUF_MIND[f], jeForm[f]),
    `${AUFRUF_MIND[f]} gegen ${jeForm[f]}`)
}

ok(`es werden noch mindestens ${AUFRUF_MIND.geprueft} Schluessel wirklich `
  + "geprueft",
  r6.geprueft >= AUFRUF_MIND.geprueft, `${r6.geprueft}`)
ok("und die Schranke darauf ist streng genug",
  mindTraegt(AUFRUF_MIND.geprueft, r6.geprueft),
  `${AUFRUF_MIND.geprueft} gegen ${r6.geprueft}`)

/*
 * DIE DECKUNG WIRD GENANNT UND NICHT VERSCHWIEGEN. Von 198 Schluesseln mit
 * Platzhalter haben 32 keinen erkannten Aufrufer. Sie sind KEIN Befund
 * dieses Satzes, aus demselben Grund, aus dem Abschnitt 5 die 64 fehlenden
 * Schluessel nicht mitzaehlt: das waere ein fremder Befund. Gemessen am
 * 09.11.2026 sind 22 von ihnen im ganzen Bestand ueberhaupt nicht gerufen,
 * also toter Text, und das gehoert in ein eigenes Paket.
 *
 * Die Zahl bekommt aber eine OBERGRENZE, denn sonst waechst die Luecke
 * unbemerkt: wer morgen einen Aufrufweg einbaut, den der Sammler nicht
 * kennt, verschiebt Schluessel aus "geprueft" nach "ohne Aufrufer", und
 * jeder Satz darueber bleibt gruen.
 */
const OHNE_AUFRUFER_HOECHSTENS = 32
ok(`hoechstens ${OHNE_AUFRUFER_HOECHSTENS} Schluessel haben keinen erkannten `
  + "Aufrufer",
  r6.ohneAufruf <= OHNE_AUFRUFER_HOECHSTENS, `${r6.ohneAufruf}`)
ok("und die Summe der drei Gruppen ist die ganze Sollmenge",
  r6.geprueft + r6.ohneAufruf + r6.mitSpread === soll6.size,
  `${r6.geprueft} + ${r6.ohneAufruf} + ${r6.mitSpread} !== ${soll6.size}`)

/*
 * DIE GEGENPROBE STEHT IN EINEM SATZ UND NICHT IN VIEREN, aus demselben
 * Grund wie bei den Koedern in Abschnitt 5: vier Einzelsaetze lassen sich
 * einzeln auf "irgendein Befund" aufweichen, ein Listenvergleich nicht.
 *
 * Die vier Koeder decken die vier Fehlerarten, die wirklich vorkommen, und
 * der dritte und vierte halten zwei Messfehler fest, die am 09.11.2026
 * echt passiert sind.
 */
const KOEDER6_EN = {
  "K6.Weg": "Hello {name}, {count} left",
  "K6.Heil": "Hello {name}, {count} left",
  "K6.Hbs": "Used {used} of {limit}",
  "K6.Kurz": "Hello {name}",
}
const KOEDER6_QUELLE = [
  // Javascript, ein Platzhalter nicht gefuellt
  'ui.notifications.info(game.i18n.format("K6.Weg", { name: wert }))',
  // Javascript, heil, ueber einen eigenen Helfer statt ueber .format
  'Lf("K6.Heil", { name: wert, count: zahl }, "fallback")',
  // Handlebars, ein Hash fehlt
  '<p>{{localize "K6.Hbs" used=belegt}}</p>',
  // Javascript, heil, in Kurzschreibweise. Messfehler 2 von oben.
  'this.#f("K6.Kurz", { name })',
]
const k6 = aufrufeSammeln(KOEDER6_QUELLE)
const k6r = ungefuellte(sollNamen(KOEDER6_EN), k6.gefuellt, k6.offen)
const K6_SOLL = ["K6.Hbs", "K6.Weg"]
ok(`die Probe findet genau die ${K6_SOLL.length} verdorbenen Koeder und `
  + "nicht die zwei heilen",
  k6r.schlecht.map((z) => z.split(" ")[0]).sort().join(",")
  === K6_SOLL.join(","),
  `gefunden: [${k6r.schlecht.map((z) => z.split(" ")[0]).sort()}], `
  + `erwartet: [${K6_SOLL}]`)
// Und die Koederliste ist nicht leer geraeumt. Ein Vergleich von "" mit ""
// haelt, und das sieht wie ein bestandener Satz aus.
ok(`die Koederliste nennt ${K6_SOLL.length} Faelle und der Koeder `
  + `${Object.keys(KOEDER6_EN).length} Saetze bei `
  + `${KOEDER6_QUELLE.length} Aufrufstellen`,
  K6_SOLL.length === 2 && Object.keys(KOEDER6_EN).length === 4
  && KOEDER6_QUELLE.length === 4 && k6r.geprueft === 4,
  `${K6_SOLL.length} / ${Object.keys(KOEDER6_EN).length} / `
  + `${KOEDER6_QUELLE.length} / geprueft ${k6r.geprueft}`)

/*
 * EINE FUENFTE GEGENPROBE ZIELT AUF DIE STREUUNG. Ein `...daten` darf nicht
 * beanstandet werden, und es darf auch nicht als geprueft gelten. Ohne
 * diesen Satz liesse sich `offen` leer raeumen, und dann wuerde jeder
 * Streu-Aufruf zum Fehlalarm, oder umgekehrt jeder Aufruf als Streuung
 * ausgenommen und der ganze Abschnitt waere wirkungslos.
 */
const STREU_EN = { "S6.Streu": "Hello {name}, {count} left" }
const streu = aufrufeSammeln(['Lf("S6.Streu", { ...daten })'])
const streuR = ungefuellte(sollNamen(STREU_EN), streu.gefuellt, streu.offen)
ok("eine Streuung wird nicht beanstandet und auch nicht als geprueft gezaehlt",
  streuR.schlecht.length === 0 && streuR.mitSpread === 1
  && streuR.geprueft === 0,
  `schlecht ${streuR.schlecht.length}, streu ${streuR.mitSpread}, `
  + `geprueft ${streuR.geprueft}`)

/*
 * UND DIE SECHSTE ZIELT AUF DEN LITERALLESER SELBST. Ein verschachteltes
 * Objekt muss ganz gelesen werden, sonst endet das Literal zu fruehe und der
 * zweite Platzhalter fehlt scheinbar.
 */
const TIEF_EN = { "T6.Tief": "Hello {name}, {count} left" }
const tief = aufrufeSammeln(
  ['Lf("T6.Tief", { teile: { a: 1, b: 2 }, name: x, count: n })'])
const tiefR = ungefuellte(sollNamen(TIEF_EN), tief.gefuellt, tief.offen)
ok("ein verschachteltes Objektliteral wird ganz gelesen",
  tiefR.schlecht.length === 0 && tiefR.geprueft === 1,
  tiefR.schlecht.join(" | ") || `geprueft ${tiefR.geprueft}`)

/* ------------------------------------------------------------------ Bilanz */

console.log(`\n${bestanden} bestanden, ${gescheitert} gescheitert`)
process.exit(gescheitert === 0 ? 0 : 1)
