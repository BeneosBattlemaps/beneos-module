/**
 * stream-bilder.test.mjs
 *
 * Gegenprobe zur Flaechenliste von `stream-bilder.mjs`. Laeuft ohne Foundry,
 * ohne Browser, ohne Netz:
 *
 *   node scripts/stream/stream-bilder.test.mjs
 *
 * Rueckgabewert 0 heisst alle Faelle gruen, 1 heisst mindestens einer rot.
 *
 * WARUM DIESER PRUEFSATZ UEBERHAUPT. `stream-bilder.mjs` hatte bis zum
 * 08.11.2026 keinen, und das war kein Versehen ohne Folgen: die Datei zieht
 * Foundry herein, also ist ihr Verhalten hier nicht fahrbar, und daraus wurde
 * "dann prueft sie eben nichts". Was aber sehr wohl hier pruefbar ist, ist der
 * **Inhalt der Liste**, und genau dort liegt der Fehler, der nicht auffaellt.
 *
 * EIN FALSCHER HAKENNAME IST EIN STILLER FEHLER. Die Karte erscheint weiter,
 * nur ohne Zwischenspeicher, ohne Offline-Vorrat und ohne Ersatzbild, also
 * genau in dem Zustand, den diese Datei beheben soll. Nichts wird rot, nichts
 * meldet sich, und eine Abweisung des Tores kommt als HTTP 200 mit einem
 * durchsichtigen GIF von 42 Byte.
 *
 * DER NAHELIEGENDE NAME IST DER FALSCHE, gemessen am 08.11.2026 in der Welt
 * `v13-streaming` (Foundry 13, dnd5e 5.3.3): die Klassenkette des Item-Blattes
 * enthaelt `ItemSheetV2` NICHT, obwohl der Kern die Klasse fuehrt, und
 * `sheet instanceof ItemSheetV2` ergibt `false`. Beim Actor ergibt dieselbe
 * Frage `true`. Wer den Item-Namen aus der Actor-Zeile ableitet, schreibt
 * `renderItemSheetV2` hin, und der Haken feuert null mal.
 *
 * WAS DIESER SATZ NICHT LEISTET. Er liest Quelltext. Dass ein Haken im
 * laufenden Foundry wirklich feuert und das Bild danach eine `blob:`-Adresse
 * traegt, entscheidet `TC-PRJ-STR-302`. Die Namen hier sind gemessen, aber
 * dieser Satz misst sie nicht, er haelt sie fest.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

let rot = 0
let gruen = 0

function gleich(name, ist, soll) {
  if (ist === soll) { gruen++; console.log(`  ok   ${name}`) }
  else {
    rot++
    console.log(`  ROT  ${name}`)
    console.log(`       soll ${JSON.stringify(soll)}`)
    console.log(`       ist  ${JSON.stringify(ist)}`)
  }
}

function wahr(name, bedingung) { gleich(name, Boolean(bedingung), true) }

const HIER = dirname(fileURLToPath(import.meta.url))
const QUELLE = readFileSync(join(HIER, "stream-bilder.mjs"), "utf8")
  .replace(/\r\n/g, "\n")

// ===========================================================================
console.log("\nDie Flaechenliste steht da und hat die Form, die der Rufer liest")

const treffer = QUELLE.match(/const FLAECHEN = \[([\s\S]*?)\n\]/)
wahr("stream-bilder.mjs fuehrt eine FLAECHEN-Liste", Boolean(treffer))

// Nur die Paare, nicht die Begruendungen um sie herum.
const paare = [...(treffer?.[1] ?? "").matchAll(
  /\[\s*"(render\w+)"\s*,\s*"(close\w+)"\s*\]/g)].map((m) => [m[1], m[2]])
const aufNamen = paare.map(([a]) => a)

/*
 * DIE ZAHL IST SELBST EIN SATZ. Eine Suche, die nichts findet, ist von einer
 * kaputten Suche nicht zu unterscheiden; ohne diese Zeile liefen alle
 * folgenden Pruefungen ueber eine leere Liste gruen durch.
 */
gleich("FLAECHEN traegt fuenf Paare", paare.length, 5)

for (const [auf, zu] of paare) {
  gleich(`${auf} und ${zu} benennen dieselbe Klasse`,
    zu, auf.replace(/^render/, "close"))
}

gleich("kein Name steht zweimal", new Set(aufNamen).size, aufNamen.length)

// ===========================================================================
console.log("\nDie fuenf Flaechen sind die gemessenen, nicht die erinnerten")

for (const pflicht of [
  "renderJournalEntrySheet",      // das Journalfenster
  "renderJournalEntryPageSheet",  // ein einzeln geoeffnetes Seitenblatt
  "renderActorSheetV2",           // das Blatt einer Kreatur
  "renderItemSheet5e",            // das Blatt eines Gegenstands oder Zaubers
  "renderImagePopout",            // die gross aufgezogene Karte
]) {
  wahr(`FLAECHEN deckt ${pflicht}`, aufNamen.includes(pflicht))
}

/*
 * DIE STUMMEN NAMEN, und sie sind der eigentliche Inhalt dieses Satzes.
 *
 * `renderActorSheet` und `renderItemSheet` sind die Namen aus Fassung 12 und
 * feuern unter Foundry 13 nicht. `renderItemSheetV2` ist der Name, den die
 * Zeile `renderActorSheetV2` darueber nahelegt, und er feuert bei dnd5e 5.3.3
 * ebenfalls nicht, weil `ItemSheet5e` nicht von `ItemSheetV2` erbt.
 */
for (const stumm of ["renderActorSheet", "renderItemSheet",
                     "renderItemSheetV2", "renderJournalSheet"]) {
  gleich(`der stumme Name ${stumm} steht NICHT in FLAECHEN`,
    aufNamen.filter((n) => n === stumm).length, 0)
}

/*
 * UND DIE ZU BREITEN NAMEN. `DocumentSheetV2` traegt Item, Actor UND Journal,
 * `ApplicationV2` und `HandlebarsApplication` tragen jedes Fenster. Ein Haken
 * darauf doppelte die anderen Zeilen, und jedes Fenster bekaeme den Helfer
 * zweimal je Render. Das waere nicht falsch, sondern teuer und unlesbar.
 */
for (const zuBreit of ["renderDocumentSheetV2", "renderApplicationV2",
                       "renderHandlebarsApplication", "renderDocumentSheet5e"]) {
  gleich(`${zuBreit} steht nicht in FLAECHEN, es doppelte die anderen Zeilen`,
    aufNamen.filter((n) => n === zuBreit).length, 0)
}

// ===========================================================================
console.log("\nDer Riegel gegen Verzeichnisse greift weiter")

/*
 * ER IST DER GRUND, WARUM `OP-PRJ-177` NICHT WIEDERKOMMT. Foundry setzt an
 * jedem Listenbild `loading="lazy"` und holt deshalb nur das Sichtbare,
 * gemessen 686 von 686. Dieser Helfer holt die Bytes dagegen SOFORT, ein Haken
 * auf ein Verzeichnis verwandelt also null Abrufe in so viele, wie die Liste
 * Zeilen hat: fuer die Szenenliste rund 609 MB gegen das Offline-Kontingent
 * des Kunden.
 *
 * Geprueft wird der Riegel aus der Quelle und nicht ein abgeschriebener: eine
 * Kopie hier liesse den Satz gruen, waehrend der echte Riegel verschwunden
 * ist.
 */
const riegelZeile = QUELLE.match(/const VERBOTEN = \/([^/\n]+)\/([a-z]*)/)
wahr("der Riegel VERBOTEN steht noch da", Boolean(riegelZeile))
const riegel = riegelZeile
  ? new RegExp(riegelZeile[1], riegelZeile[2])
  : /$^/

wahr("der Riegel wird im Rufer auf BEIDE Namen angewandt",
  /VERBOTEN\.test\(renderHaken\)\s*\|\|\s*VERBOTEN\.test\(schliessHaken\)/
    .test(QUELLE))

for (const n of aufNamen) {
  gleich(`${n} faellt nicht unter den Riegel`, riegel.test(n), false)
}

/*
 * Und die Gegenrichtung, sonst waere ein Riegel, der nie zuschlaegt, von
 * einem kaputten nicht zu unterscheiden. `renderItemDirectory5e` ist der
 * naechste Verwandte der neuen Zeile und damit der Name, der hier am
 * wahrscheinlichsten eines Tages hineinwandert.
 */
for (const boese of ["renderItemDirectory5e", "renderActorDirectory",
                     "renderSidebarTab", "renderFilePicker"]) {
  wahr(`der Riegel wuerde ${boese} abweisen`, riegel.test(boese))
}

// ===========================================================================
console.log("\nDer Kopf widerspricht der Liste unter sich nicht")

/*
 * EIN KOPFKOMMENTAR, DER DIE LISTE WIDERLEGT, IST SCHLIMMER ALS KEINER: er
 * haelt den naechsten Leser davon ab, die Zeile zu suchen, die schon da ist.
 * Bis zum 08.11.2026 stand im Kopf "Keine Klappkarten", und das war richtig,
 * solange diese Karten oertlich lagen. Mit `OP-PRJ-140` liegen sie am Tor.
 */
gleich("der Kopf behauptet nicht mehr, Klappkarten seien aussen vor",
  (QUELLE.match(/\*\*Keine Klappkarten/g) || []).length, 0)
wahr("der Kopf nennt stattdessen, seit wann sie mitgehen",
  /Klappkarten gehen seit dem 08\.11\.2026 mit/.test(QUELLE))

// Die drei Grenzen, die Absicht sind und bleiben, muessen weiter dastehen.
for (const grenze of ["Kein `<video>`", "Keine Listen", "Keine Bearbeitenflaeche"]) {
  wahr(`der Kopf nennt die Grenze "${grenze}" weiter`, QUELLE.includes(grenze))
}

// ---------------------------------------------------------------------------
console.log(`\n${gruen} bestanden, ${rot} gescheitert`)
console.log("\nNicht geprueft, ausdruecklich benannt:")
console.log("- Dass ein Haken im laufenden Foundry feuert. Die fuenf Namen sind am")
console.log("  08.11.2026 in `v13-streaming` gemessen, dieser Satz haelt sie nur")
console.log("  fest. Die Wirkung entscheidet TC-PRJ-STR-302.")
console.log("- Ob das Bild nach dem Lauf eine `blob:`-Adresse traegt. Das braucht")
console.log("  Foundry, Handlebars und ein gefuelltes Tor.")
console.log("- Die Freigabe der Blob-Adressen. `allesLoslassen()` ist hier nicht")
console.log("  fahrbar, weil sie an einem Fenster haengt.")
console.log("- Ob dnd5e in einer kuenftigen Fassung `ItemSheet5e` auf")
console.log("  `ItemSheetV2` umstellt. Dann feuert der Name hier weiter, weil")
console.log("  Foundry die ganze Kette feuert; die Zeile waere nur nicht mehr die")
console.log("  knappste.")

process.exit(rot > 0 ? 1 : 0)
